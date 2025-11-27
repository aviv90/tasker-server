/**
 * Helper Script to Get Google Drive Refresh Token
 * 
 * This script helps you get a refresh token for Google Drive API access.
 * Run: node scripts/get-google-drive-token.js
 */

const readline = require('readline');
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getRefreshToken() {
  console.log('\n🔐 Google Drive OAuth Token Helper\n');
  console.log('אני אעזור לך לקבל Refresh Token ל-Google Drive API.\n');

  // Get Client ID
  const clientId = await question('הכנס את ה-Client ID שלך: ');
  if (!clientId) {
    console.error('❌ Client ID נדרש!');
    process.exit(1);
  }

  // Get Client Secret
  const clientSecret = await question('הכנס את ה-Client Secret שלך: ');
  if (!clientSecret) {
    console.error('❌ Client Secret נדרש!');
    process.exit(1);
  }

  // Get Redirect URI
  const redirectUri = await question('הכנס את ה-Redirect URI (ברירת מחדל: http://localhost:3000/oauth2callback): ') || 'http://localhost:3000/oauth2callback';

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  // Generate auth URL
  const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  console.log('\n📋 פתח את ה-URL הבא בדפדפן:');
  console.log(authUrl);
  console.log('\n⏳ ממתין לאימות...\n');

  // Note: User needs to open the URL manually
  console.log('💡 העתק את ה-URL למעלה ופתח אותו בדפדפן.\n');

  // Start local server to receive callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const queryObject = url.parse(req.url, true).query;
        const code = queryObject.code;

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head><title>הצלחה!</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px; direction: rtl;">
                <h1>✅ הצלחת!</h1>
                <p>אתה יכול לסגור את החלון הזה.</p>
                <p>חזור לטרמינל כדי לראות את ה-Refresh Token.</p>
              </body>
            </html>
          `);

          // Exchange code for tokens
          const { tokens } = await oauth2Client.getToken(code);
          
          server.close();

          console.log('\n✅ הצלחת! הנה הנתונים שלך:\n');
          console.log('═══════════════════════════════════════════════════');
          console.log('📋 הוסף את המשתנים הבאים לקובץ .env:\n');
          console.log(`GOOGLE_DRIVE_CLIENT_ID=${clientId}`);
          console.log(`GOOGLE_DRIVE_CLIENT_SECRET=${clientSecret}`);
          console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
          console.log(`GOOGLE_DRIVE_REDIRECT_URI=${redirectUri}`);
          console.log('\n═══════════════════════════════════════════════════\n');

          if (tokens.refresh_token) {
            resolve(tokens.refresh_token);
          } else {
            console.error('⚠️  לא קיבלתי Refresh Token. נסה שוב עם prompt=consent.');
            reject(new Error('No refresh token received'));
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head><title>שגיאה</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px; direction: rtl;">
                <h1>❌ שגיאה</h1>
                <p>לא קיבלתי authorization code.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('No authorization code received'));
        }
      } catch (error) {
        server.close();
        reject(error);
      }
    });

    server.listen(3000, () => {
      console.log('🌐 שרת מקומי רץ על http://localhost:3000/oauth2callback');
      console.log('⏳ ממתין לאימות...\n');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timeout: No response received within 5 minutes'));
    }, 300000);
  });
}

// Run the script
getRefreshToken()
  .then(() => {
    console.log('✅ סיימת! כל הנתונים מוכנים לשימוש.\n');
    rl.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ שגיאה:', error.message);
    rl.close();
    process.exit(1);
  });

