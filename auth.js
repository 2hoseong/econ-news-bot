const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { google } = require("googleapis");

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("credentials.json 파일이 필요합니다.");
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
}

async function authorize() {
  const credentials = loadCredentials();
  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  if (fs.existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")));
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("이 URL을 브라우저에서 열어서 인증하세요:");
  console.log(authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise((resolve) =>
    rl.question("인증 코드를 입력하세요: ", (answer) => resolve(answer.trim()))
  );

  rl.close();

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

  console.log("token.json 생성 완료");
  return oAuth2Client;
}

module.exports = { authorize };