import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { normalizeSql } from '../common/sql-helper';

@WebSocketGateway({ namespace: '/hubs/glucose', cors: { origin: false } })
export class GlucoseGateway {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DataSource,
  ) {}

  private q(sql: string, params?: unknown[]) {
    return this.db.query(normalizeSql(sql, this.db), params);
  }

  async handleConnection(client: Socket) {
    try {
      const rawToken = String(
        client.handshake.auth?.token ??
          client.handshake.headers?.authorization ??
          '',
      ).replace(/^Bearer /i, '').trim();

      if (!rawToken) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwt.verifyAsync<{
        sub: string;
        token_type?: string;
        token_version?: number;
      }>(rawToken);

      if (payload.token_type === 'refresh') {
        client.disconnect(true);
        return;
      }

      const userId = Number(payload.sub);
      const rows = await this.q(
        'SELECT Id, IsActive, TokenVersion FROM Users WHERE Id=?',
        [userId],
      );

      if (!rows.length || !rows[0].IsActive) {
        client.disconnect(true);
        return;
      }

      if (
        payload.token_version != null &&
        Number(rows[0].TokenVersion) !== Number(payload.token_version)
      ) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('JoinFamily')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() familyId: number,
  ) {
    const userId = Number(client.data?.userId);
    if (!userId || !familyId) {
      return { error: 'Unauthorized or invalid family ID' };
    }

    // Verify membership: caller must be owner or active member of this family
    const allowed = await this.q(
      'SELECT f.Id FROM Families f LEFT JOIN FamilyMembers m ON m.FamilyId=f.Id AND m.UserId=? AND m.Status="Active" WHERE f.Id=? AND f.IsActive=1 AND (f.OwnerUserId=? OR m.Id IS NOT NULL)',
      [userId, familyId, userId],
    );

    if (!allowed.length) {
      return { error: 'Forbidden: You are not an active member of this family circle.' };
    }

    void client.join(`family_${familyId}`);
    return { joined: familyId };
  }

  publish(familyIds: number[], payload: unknown) {
    if (!this.server) return;
    for (const id of familyIds) {
      if (id != null) {
        this.server.to(`family_${id}`).emit('ReceiveGlucoseUpdate', payload);
      }
    }
  }
}
