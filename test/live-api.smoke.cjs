require('dotenv').config();
const mysql = require('mysql2/promise');

const base = process.env.LIVE_API_URL || 'http://127.0.0.1:5000';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const password = 'CgmSmoke!234';
const finalPassword = 'CgmSmoke!567';
const emails = [
  process.env.SMOKE_ADMIN_EMAIL || `cgm-node-smoke-owner-${stamp}@example.invalid`,
  `cgm-node-smoke-member-${stamp}@example.invalid`,
  `cgm-node-smoke-leaver-${stamp}@example.invalid`,
];
const results = [];
const ids = { users: [], devices: [], sensors: [], rules: [], endpoints: [], alerts: [], versions: [] };

function connectionOptions() {
  const raw = (process.env.DB_CONNECTION_STRING || '').trim().replace(/^["']|["']$/g, '');
  const p = Object.fromEntries(raw.split(';').filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i).trim().toLowerCase(),x.slice(i+1).trim()]; }));
  return { host:p.server||p.host, port:Number(p.port||3306), user:p.user||p['user id']||p.uid, password:p.password||p.pwd, database:p.database||p['initial catalog'], ssl:p.sslmode && !/none|disabled/i.test(p.sslmode) ? {rejectUnauthorized:false}:undefined };
}
async function api(name, method, path, body, token, expected=[200,201,204]) {
  const response = await fetch(base + path, { method, headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})}, body:body===undefined?undefined:JSON.stringify(body) });
  const text=await response.text(); let data; try{data=text?JSON.parse(text):null;}catch{data=text;}
  const ok=expected.includes(response.status); results.push({name,method,path,status:response.status,ok,detail:ok?undefined:data});
  if(!ok) throw new Error(`${name}: expected ${expected.join('/')} but received ${response.status}: ${text.slice(0,500)}`);
  return data;
}
async function cleanup(db) {
  let reconnected=false; try { await db.query('SELECT 1'); } catch { db = mysql.createPool({...connectionOptions(),connectionLimit:2}); reconnected=true; }
  const userIds=ids.users.filter(Boolean); if(!userIds.length)return;
  const marks=userIds.map(()=>'?').join(',');
  const statements=[
    ['DELETE FROM AlertDeliveryHistory WHERE AlertId IN (SELECT Id FROM Alerts WHERE UserId IN ('+marks+'))',userIds],
    ['DELETE FROM AlertQueue WHERE AlertId IN (SELECT Id FROM Alerts WHERE UserId IN ('+marks+'))',userIds],
    ['DELETE FROM AlertRecipients WHERE UserId IN ('+marks+') OR AlertId IN (SELECT Id FROM Alerts WHERE UserId IN ('+marks+'))',[...userIds,...userIds]],
    ['DELETE FROM Alerts WHERE UserId IN ('+marks+')',userIds],
    ['DELETE FROM AlertRules WHERE UserId IN ('+marks+')',userIds],['DELETE FROM NotificationEndpoints WHERE UserId IN ('+marks+')',userIds],
    ['DELETE FROM DailyGlucoseSummaries WHERE UserId IN ('+marks+')',userIds],['DELETE FROM GlucoseMeasurements WHERE UserId IN ('+marks+')',userIds],
    ['DELETE FROM Sensors WHERE UserId IN ('+marks+')',userIds],['DELETE FROM CGMDevices WHERE UserId IN ('+marks+')',userIds],
    ['DELETE FROM PhoneHardwareLogs WHERE UserId IN ('+marks+')',userIds],['DELETE FROM FamilyMembers WHERE UserId IN ('+marks+')',userIds],
    ['DELETE FROM FamilyMembers WHERE FamilyId IN (SELECT Id FROM Families WHERE OwnerUserId IN ('+marks+'))',userIds],
    ['DELETE FROM Families WHERE OwnerUserId IN ('+marks+')',userIds],['DELETE FROM PasswordResetRequests WHERE UserId IN ('+marks+') OR Email IN (?,?,?)',[...userIds,...emails]],
    ['DELETE FROM PatientProfile WHERE UserId IN ('+marks+')',userIds],['DELETE FROM Users WHERE Id IN ('+marks+')',userIds],
    ...(ids.versions.filter(Boolean).length ? [['DELETE FROM AppVersions WHERE Id IN ('+ids.versions.filter(Boolean).map(()=>'?').join(',')+')',ids.versions.filter(Boolean)]] : []),
  ];
  for(const [sql,args] of statements){try{await db.query(sql,args);}catch(e){results.push({name:'cleanup',method:'SQL',path:sql.slice(0,55),status:0,ok:false,detail:e.message});}}
  if(reconnected) await db.end();
}
async function main(){
  const db=mysql.createPool({...connectionOptions(),connectionLimit:2});
  let owner,member,leaver;
  try{
    await api('root','GET','/'); await api('health','GET','/health'); await api('metrics','GET','/metrics');
    await api('unauthorized guard','GET','/api/Profile',undefined,null,[401]);
    const register=async(i)=>{const r=await api(`register ${i}`,'POST','/api/Auth/register',{fullName:`Smoke User ${i}`,email:emails[i],password,phoneNumber:'+10000000000',preferredGlucoseUnit:'mg/dL'});ids.users.push(r.user.id);return r;};
    owner=await register(0); member=await register(1); leaver=await register(2);
    const login=await api('login','POST','/api/Auth/login',{email:emails[0],password,deviceId:`smoke-${stamp}`,deviceInfo:'Node smoke test'});
    owner=login; await api('refresh token','POST','/api/Auth/refresh-token',{refreshToken:owner.refreshToken});
    await api('social invalid token','POST','/api/Auth/social',{provider:'Google',idToken:'invalid'},null,[400,401,503]);
    await api('forgot password','POST','/api/Auth/forgot-password',{email:emails[0]});
    const [resetRows]=await db.query('SELECT Token,OtpCode FROM PasswordResetRequests WHERE Email=? AND IsUsed=0 ORDER BY CreatedAt DESC LIMIT 1',[emails[0]]);
    if(!resetRows.length)throw new Error('forgot password did not create reset request');
    await api('verify reset code','POST','/api/Auth/verify-reset-code',{email:emails[0],code:resetRows[0].OtpCode});
    await api('reset password','POST','/api/Auth/reset-password',{email:emails[0],tokenOrCode:resetRows[0].Token,newPassword:finalPassword});
    owner=await api('login reset password','POST','/api/Auth/login',{email:emails[0],password:finalPassword});
    await api('change password','POST','/api/Auth/change-password',{currentPassword:finalPassword,newPassword:password},owner.accessToken);
    owner=await api('login changed password','POST','/api/Auth/login',{email:emails[0],password});
    await api('profile get','GET','/api/Profile',undefined,owner.accessToken);
    await api('profile update','PUT','/api/Profile',{fullName:'Smoke Owner Updated',phoneNumber:'+10000000001',dateOfBirth:'1990-01-01',gender:'Other',preferredGlucoseUnit:'mg/dL',theme:'System',language:'English'},owner.accessToken);
    const device=await api('device register','POST','/api/Devices/register',{deviceName:'Smoke CGM',deviceType:'Disposable',deviceModel:'G-AA',serialNumber:`SMOKE-DEV-${stamp}`,bleDeviceName:'SMOKE_BLE',firmwareVersion:'test',batteryVoltageMv:3100},owner.accessToken);ids.devices.push(device.id);
    await api('device list','GET','/api/Devices',undefined,owner.accessToken); await api('device get','GET',`/api/Devices/${device.id}`,undefined,owner.accessToken);
    await api('device update legacy','PUT',`/api/Devices/${device.id}`,{connectionStatus:'Connected',batteryVoltageMv:3050,batteryPercentage:90},owner.accessToken);
    await api('device update status','PUT',`/api/Devices/${device.id}/status`,{connectionStatus:'Connected',batteryVoltageMv:3040,batteryPercentage:89},owner.accessToken);
    const sensor=await api('sensor start','POST','/api/Sensors/start',{deviceId:device.id,sensorIdentifier:`SMOKE-SENSOR-${stamp}`,warmupMinutes:1},owner.accessToken);ids.sensors.push(sensor.id);
    await db.query('UPDATE Sensors SET ActivatedAt=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE),Status="Active" WHERE Id=?',[sensor.id]);
    await api('sensor active','GET','/api/Sensors/active',undefined,owner.accessToken);
    const now=new Date(Date.now()-5000).toISOString();
    await api('glucose measurement','POST','/api/Glucose/measurement',{sensorId:sensor.id,glucoseValue:150,measurementTime:now,batteryVoltageMv:3030,deviceTemperatureC:32.1,we1CurrentNa:1.25,sequenceNumber:1},owner.accessToken);
    await api('glucose duplicate','POST','/api/Glucose/measurement',{sensorId:sensor.id,glucoseValue:150,measurementTime:now,sequenceNumber:1},owner.accessToken);
    await api('glucose bulk','POST','/api/Glucose/sync-bulk',{sensorId:sensor.id,measurements:[{sensorId:sensor.id,glucoseValue:250,measurementTime:new Date(Date.now()-3000).toISOString(),sequenceNumber:2},{sensorId:sensor.id,glucoseValue:65,measurementTime:new Date(Date.now()-1000).toISOString(),sequenceNumber:3}]},owner.accessToken);
    await api('glucose history','GET',`/api/Glucose/history?sensorId=${sensor.id}&hours=24&page=1&pageSize=50`,undefined,owner.accessToken);
    await api('glucose summary','GET',`/api/Glucose/summary?sensorId=${sensor.id}`,undefined,owner.accessToken);
    const rule=await api('alert rule create','POST','/api/alert-rules',{alertType:'SmokeRule',minimumValue:70,maximumValue:180,durationMinutes:5,enabled:true},owner.accessToken);ids.rules.push(rule.Id||rule.id);
    await api('alert rules list','GET','/api/alert-rules',undefined,owner.accessToken); await api('alert rule update','PUT',`/api/alert-rules/${rule.Id||rule.id}`,{alertType:'SmokeRule',minimumValue:65,maximumValue:190,durationMinutes:10,enabled:true},owner.accessToken);
    const alerts=await api('alerts list','GET','/api/Alerts?unreadOnly=true',undefined,owner.accessToken); if(alerts.length){ids.alerts.push(alerts[0].id);await api('alert read','PUT',`/api/Alerts/${alerts[0].id}/read`,{},owner.accessToken);}
    const endpoint=await api('notification endpoint save','POST','/api/notification-endpoints',{channel:'Push',address:`https://example.invalid/cgm-smoke/${stamp}`,enabled:false},owner.accessToken);ids.endpoints.push(endpoint.Id||endpoint.id);
    await api('notification endpoints list','GET','/api/notification-endpoints',undefined,owner.accessToken);
    const family=await api('family create','POST','/api/Family/create',{},owner.accessToken);
    await api('family get','GET','/api/Family',undefined,owner.accessToken);
    await api('family member join','POST','/api/Family/join',{referralCode:owner.user.referralCode},member.accessToken);
    await api('family leaver join','POST','/api/Family/join',{referralCode:owner.user.referralCode},leaver.accessToken);
    await api('family members','GET','/api/Family/members',undefined,owner.accessToken);
    await api('family alerts preference','PUT',`/api/Family/members/${member.user.id}/alerts`,{receiveAlerts:true},owner.accessToken);
    await api('family role','PUT',`/api/Family/members/${member.user.id}/role`,{role:'Caregiver'},owner.accessToken);
    await api('family thresholds','PUT','/api/Family/thresholds',{lowThreshold:70,highThreshold:180},owner.accessToken);
    await api('family weekly report','GET','/api/Family/weekly-report',undefined,owner.accessToken);
    await api('family member report','GET',`/api/Family/members/${member.user.id}/report-summary`,undefined,owner.accessToken);
    await api('family notify','POST','/api/Family/notify',{},owner.accessToken);
    await api('family leave','POST','/api/Family/leave',{},leaver.accessToken);
    await api('family remove member','DELETE',`/api/Family/members/${member.user.id}`,undefined,owner.accessToken);
    await api('detailed report','GET','/api/Reports/detailed',undefined,owner.accessToken);
    await api('articles list','GET','/api/Articles'); const articles=await api('articles category','GET','/api/Articles?category=Education'); await api('article get','GET',`/api/Articles/${articles[0]?.Id||articles[0]?.id||999999999}`,undefined,null,articles.length?[200]:[404]);
    await api('dictionary foods','GET','/api/Dictionaries/foods'); await api('dictionary insulins','GET','/api/Dictionaries/insulins'); await api('dictionary moods','GET','/api/Dictionaries/moods');
    const platform='Android'; const version=await api('app version create','POST','/api/AppVersion',{platform,versionName:`smoke-${stamp}`,versionCode:2000000000+Number(stamp.slice(-7)),minimumSupportedVersion:'1.0.0',downloadUrl:'https://example.invalid/test.apk',releaseNotes:`smoke-${stamp}`,isMandatory:false});ids.versions.push(version.id);
    await api('app version latest','GET',`/api/AppVersion/latest?platform=${encodeURIComponent(platform)}`);
    await api('hardware log','POST','/api/DeviceHardware/log',{manufacturer:'Smoke',model:'Test',platform:'Android',osVersion:'1',appVersion:'1',rawData:'{}'},owner.accessToken);
    await api('admin users','GET','/api/Admin/users',undefined,owner.accessToken); await api('admin stats','GET','/api/Admin/stats',undefined,owner.accessToken); await api('admin disable user','POST',`/api/Admin/users/${leaver.user.id}/disable`,{},owner.accessToken);
    await api('alert rule delete','DELETE',`/api/alert-rules/${rule.Id||rule.id}`,undefined,owner.accessToken); await api('notification endpoint delete','DELETE',`/api/notification-endpoints/${endpoint.Id||endpoint.id}`,undefined,owner.accessToken);
    await api('sensor stop','POST','/api/Sensors/stop',{},owner.accessToken); await api('device delete','DELETE',`/api/Devices/${device.id}`,undefined,owner.accessToken);
    await api('auth logout','POST','/api/Auth/logout',{},owner.accessToken); await api('account logout all','POST','/api/Account/logout-all',{},member.accessToken); await api('auth logout all','POST','/api/Auth/logout-all',{},owner.accessToken);
    await api('old refresh rejected after logout-all','POST','/api/Auth/refresh-token',{refreshToken:owner.refreshToken},null,[401]);
    await api('account delete','DELETE','/api/Auth/account',undefined,member.accessToken);
  } finally { await cleanup(db); await db.end(); }
  const failed=results.filter(x=>!x.ok); console.log(JSON.stringify({total:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2)); if(failed.length)process.exitCode=1;
}
main().catch(async e=>{console.error(e.stack||e);console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results},null,2));process.exitCode=1;});
