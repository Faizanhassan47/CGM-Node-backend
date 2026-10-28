import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);

  onModuleInit() {
    if (!getApps().length) {
      initializeApp({ credential: applicationDefault() });
    }
    this.logger.log('Firebase Admin SDK initialized');
  }

  get messaging(): Messaging {
    return getMessaging();
  }
}
