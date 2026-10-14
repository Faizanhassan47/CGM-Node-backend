import { databaseConfig, parseDotnetConnectionString } from './database';
describe('legacy database configuration', () => {
  it('parses the ASP.NET MySQL connection string without changing credentials', () => {
    const parsed = parseDotnetConnectionString('"Server=db.local;Port=3307;Database=cgm;User=app;Password=p=a=s=s;SslMode=Preferred;"');
    expect(parsed.server).toBe('db.local');
    expect(parsed.password).toBe('p=a=s=s');
    expect(parsed.sslmode).toBe('Preferred');
    const config = databaseConfig('Server=db.local;Port=3307;Database=cgm;User=app;Password=secret;');
    expect(config).toMatchObject({ type: 'mysql', host: 'db.local', port: 3307, database: 'cgm', username: 'app', synchronize: false });
  });
});
