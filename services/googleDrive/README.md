# Google Drive Integration

תשתית לחיבור Google Drive למערכת, המאפשרת לסוכן לחפש ולהוריד מסמכים, תמונות וקבצים מ-Google Drive.

## הגדרה

### 1. הגדרת OAuth 2.0 ב-Google Cloud Console

1. עבור ל-[Google Cloud Console](https://console.cloud.google.com/)
2. צור פרויקט חדש או בחר פרויקט קיים
3. הפעל את Google Drive API
4. צור OAuth 2.0 credentials:
   - עבור ל-APIs & Services > Credentials
   - לחץ על "Create Credentials" > "OAuth client ID"
   - בחר "Web application"
   - הוסף Redirect URI: `http://localhost:3000/oauth2callback` (או ה-URL של השרת שלך)

### 2. קבלת Refresh Token

לאחר יצירת OAuth credentials, תצטרך לקבל refresh token:

1. השתמש ב-Client ID ו-Client Secret שיצרת
2. בצע OAuth flow כדי לקבל authorization code
3. החלף את ה-authorization code ב-refresh token

**דוגמה לקבלת Refresh Token:**

```bash
# 1. קבל authorization URL
curl "https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000/oauth2callback&response_type=code&scope=https://www.googleapis.com/auth/drive.readonly&access_type=offline&prompt=consent"

# 2. פתח את ה-URL בדפדפן, התחבר והסכם
# 3. העתק את ה-authorization code מה-redirect URI
# 4. החלף את ה-code ב-refresh token:
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTHORIZATION_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:3000/oauth2callback"
```

### 3. הגדרת Environment Variables

📖 **למדריך מפורט שלב-אחר-שלב, ראה:** [`SETUP_GUIDE.md`](./SETUP_GUIDE.md)

הוסף את המשתנים הבאים ל-`.env`:

```bash
# Google Drive OAuth
GOOGLE_DRIVE_CLIENT_ID=your_client_id_here
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token_here
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:3000/oauth2callback

# תיקייה ספציפית לחיפוש (אופציונלי)
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here
```

💡 **טיפ:** השתמש ב-`scripts/get-google-drive-token.js` כדי לקבל את ה-Refresh Token בקלות!

### 4. שימוש

הסוכן יכול כעת להשתמש ב-`search_google_drive` tool כדי לחפש מידע ב-Google Drive:

- "חפש במסמכים שלי"
- "מה יש בתיקייה X"
- "מצא מידע על Y ב-Drive"

הכלי יחפש גם בשמות הקבצים וגם בתוכן הקבצים (כאשר אפשרי), ויחלץ טקסט מתמונות ומסמכים.

## תכונות

- ✅ חיפוש קבצים ב-Google Drive
- ✅ חילוץ טקסט מתמונות (באמצעות Gemini Vision)
- ✅ חילוץ טקסט ממסמכים
- ✅ תמיכה בתיקיות ספציפיות
- ✅ תמיכה ב-retry mechanism
- ✅ RAG-like functionality - חיפוש וחילוץ מידע רלוונטי

## מבנה הקוד

```
services/googleDrive/
├── index.ts              # Main entry point
├── authOperations.ts     # OAuth 2.0 authentication
└── driveOperations.ts    # Drive API operations

services/agent/tools/
└── driveTools.ts        # Agent tool definition
```

## הערות

- יש להגדיר `GOOGLE_DRIVE_FOLDER_ID` אם רוצים לחפש בתיקייה ספציפית
- ה-refresh token מאפשר גישה מתמשכת ללא צורך באימות מחדש

