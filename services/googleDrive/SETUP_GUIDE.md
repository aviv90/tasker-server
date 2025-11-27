# מדריך הגדרה מלא - Google Drive Integration

מדריך שלב-אחר-שלב לקבלת כל הנתונים הנדרשים להתחברות ל-Google Drive.

## 📋 מה אתה צריך להכין:

1. **Client ID** - מזהה האפליקציה
2. **Client Secret** - סוד האפליקציה
3. **Refresh Token** - טוקן לגישה מתמשכת
4. **Folder ID** (אופציונלי) - מזהה התיקייה הספציפית לחיפוש

---

## 🚀 שלב 1: יצירת פרויקט ב-Google Cloud Console

1. עבור ל-[Google Cloud Console](https://console.cloud.google.com/)
2. לחץ על "Select a project" למעלה
3. לחץ על "New Project"
4. תן שם לפרויקט (לדוגמה: "Tasker Drive Integration")
5. לחץ על "Create"

---

## 🔑 שלב 2: הפעלת Google Drive API

1. בפרויקט שיצרת, עבור ל-**APIs & Services** > **Library**
2. חפש "Google Drive API"
3. לחץ על "Google Drive API"
4. לחץ על **Enable** (הפעל)

---

## 🔐 שלב 3: יצירת OAuth 2.0 Credentials

### 3.1 הגדרת OAuth Consent Screen

1. עבור ל-**APIs & Services** > **OAuth consent screen**
2. בחר **External** (או Internal אם יש לך Google Workspace)
3. לחץ על **Create**
4. מלא את הפרטים:
   - **App name**: Tasker Drive Integration (או שם אחר)
   - **User support email**: האימייל שלך
   - **Developer contact information**: האימייל שלך
5. לחץ על **Save and Continue**
6. ב-**Scopes**, לחץ על **Add or Remove Scopes**
7. חפש והוסף: `https://www.googleapis.com/auth/drive.readonly`
8. לחץ על **Update** ואז **Save and Continue**
9. ב-**Test users** (אם בחרת External), הוסף את האימייל שלך
10. לחץ על **Save and Continue** ואז **Back to Dashboard**

### 3.2 יצירת OAuth Client ID

1. עבור ל-**APIs & Services** > **Credentials**
2. לחץ על **+ CREATE CREDENTIALS** > **OAuth client ID**
3. בחר **Web application**
4. תן שם (לדוגמה: "Tasker Drive Client")
5. ב-**Authorized redirect URIs**, לחץ על **+ ADD URI**
6. הוסף: `http://localhost:3000/oauth2callback`
   - אם השרת שלך רץ על פורט אחר או URL אחר, שנה בהתאם
7. לחץ על **Create**
8. **חשוב!** העתק את ה-**Client ID** וה-**Client Secret** - תצטרך אותם בהמשך!

---

## 🎫 שלב 4: קבלת Refresh Token

יש לך שתי אפשרויות:

### אפשרות A: שימוש ב-Script Helper (מומלץ)

יצרתי script שיעזור לך לקבל את ה-Refresh Token בקלות:

```bash
# הרץ את ה-script
node scripts/get-google-drive-token.js
```

הקובץ יפתח דפדפן, תצטרך להתחבר ולהסכים, ואז תקבל את ה-Refresh Token.

### אפשרות B: תהליך ידני

#### 4.1 קבלת Authorization Code

1. בנה את ה-URL הבא (החלף `YOUR_CLIENT_ID` ב-Client ID שיצרת):

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000/oauth2callback&response_type=code&scope=https://www.googleapis.com/auth/drive.readonly&access_type=offline&prompt=consent
```

2. פתח את ה-URL בדפדפן
3. התחבר לחשבון Google שלך
4. הסכם להרשאות
5. תועבר ל-`http://localhost:3000/oauth2callback?code=AUTHORIZATION_CODE`
6. **העתק את ה-`code=` מה-URL** - זה ה-Authorization Code שלך

#### 4.2 החלפת Authorization Code ב-Refresh Token

הרץ את הפקודה הבאה (החלף את הערכים):

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTHORIZATION_CODE_FROM_STEP_4.1" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:3000/oauth2callback"
```

תקבל תשובה JSON עם `refresh_token` - העתק אותו!

---

## 📁 שלב 5: קבלת Folder ID (אופציונלי)

אם אתה רוצה שהחיפוש יהיה בתיקייה ספציפית:

1. פתח את Google Drive בדפדפן
2. עבור לתיקייה הרצויה
3. ה-URL יהיה משהו כמו: `https://drive.google.com/drive/folders/1ABC123xyz...`
4. **העתק את החלק אחרי `/folders/`** - זה ה-Folder ID שלך

---

## ✅ שלב 6: הגדרת Environment Variables

הוסף את כל הנתונים שקיבלת לקובץ `.env`:

```bash
# Google Drive OAuth
GOOGLE_DRIVE_CLIENT_ID=העתק_כאן_את_ה_Client_ID
GOOGLE_DRIVE_CLIENT_SECRET=העתק_כאן_את_ה_Client_Secret
GOOGLE_DRIVE_REFRESH_TOKEN=העתק_כאן_את_ה_Refresh_Token
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:3000/oauth2callback

# תיקייה ספציפית לחיפוש (אופציונלי)
GOOGLE_DRIVE_FOLDER_ID=העתק_כאן_את_ה_Folder_ID_אם_יש
```

---

## 🧪 שלב 7: בדיקה

לאחר הגדרת כל המשתנים, הפעל מחדש את השרת ונסה:

```
חפש במסמכים שלי
```

או:

```
מה יש בתיקייה X
```

---

## 📝 סיכום - מה אתה צריך לתת לי:

לאחר שתסיים את כל השלבים, תצטרך לתת לי:

1. ✅ **Client ID** - מהשלב 3.2
2. ✅ **Client Secret** - מהשלב 3.2
3. ✅ **Refresh Token** - מהשלב 4
4. ✅ **Folder ID** (אופציונלי) - מהשלב 5, אם רוצה תיקייה ספציפית

---

## 🆘 פתרון בעיות

### "invalid_grant" error
- ודא שה-Refresh Token עדיין תקף
- נסה לקבל Refresh Token חדש

### "unauthorized" error
- ודא שה-Client ID וה-Client Secret נכונים
- ודא שה-Google Drive API מופעל בפרויקט

### לא מוצא קבצים
- ודא שה-Folder ID נכון (אם השתמשת בו)
- ודא שיש לך הרשאות לקרוא את הקבצים

---

## 📚 משאבים נוספים

- [Google Drive API Documentation](https://developers.google.com/drive/api)
- [OAuth 2.0 for Web Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

