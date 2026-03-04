console.log("🔥 kakao.js LOADED");

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

const ENV_PATH = path.join(__dirname, ".env");

// ====== 중복 전송 방지(프로세스 내) ======
let LAST_SENT_HASH = null;
let LAST_SENT_AT = 0;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ====== .env 업데이트 유틸 ======
function updateEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = content.split(/\r?\n/);

  let found = false;
  const newLines = lines.map((line) => {
    if (line.startsWith(key + "=")) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) newLines.push(`${key}=${value}`);

  const cleaned = newLines.filter((l, idx, arr) => !(l === "" && idx === arr.length - 1));
  fs.writeFileSync(ENV_PATH, cleaned.join("\n") + "\n", "utf-8");
}

// ====== 카카오 토큰 갱신 ======
async function refreshKakaoToken() {
  const clientId = process.env.KAKAO_CLIENT_ID;
  const refreshToken = process.env.KAKAO_REFRESH_TOKEN;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET; // 있으면 사용

  if (!clientId) throw new Error("KAKAO_CLIENT_ID가 .env에 없습니다.");
  if (!refreshToken) throw new Error("KAKAO_REFRESH_TOKEN이 .env에 없습니다.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });

  if (clientSecret) body.append("client_secret", clientSecret);

  const res = await axios.post("https://kauth.kakao.com/oauth/token", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const { access_token, refresh_token } = res.data;

  if (access_token) {
    updateEnvKey("KAKAO_ACCESS_TOKEN", access_token);
    process.env.KAKAO_ACCESS_TOKEN = access_token;
  }
  if (refresh_token) {
    updateEnvKey("KAKAO_REFRESH_TOKEN", refresh_token);
    process.env.KAKAO_REFRESH_TOKEN = refresh_token;
  }

  return res.data;
}

// ====== 카카오 메시지 전송 ======
async function sendToKakao(text) {
  const token = process.env.KAKAO_ACCESS_TOKEN;
  if (!token) throw new Error("KAKAO_ACCESS_TOKEN이 .env에 없습니다.");

  // ✅ 버튼 링크는 env로도 바꿀 수 있게 (나중에 Render 리다이렉트로 갈아끼우기 쉬움)
  const GMAIL_LINK =
    process.env.GMAIL_LINK ||
    "https://mail.google.com/mail/u/0/#label/%EA%B2%BD%EC%A0%9C%EB%89%B4%EC%8A%A4";

  // 메시지 길이 안전장치
  const MAX = 900;
  const msg = (text || "").trim();
  const safeMsg = msg.length > MAX ? msg.slice(0, MAX) + "\n...(생략)" : msg;

  // ✅ 같은 내용이 30초 이내 또 보내지면 차단
  const now = Date.now();
  const h = sha256(safeMsg);
  if (LAST_SENT_HASH === h && now - LAST_SENT_AT < 30_000) {
    console.log("🟡 중복 전송 감지: 30초 이내 동일 메시지 → 전송 생략");
    return { skipped: true };
  }

  // ✅ text 템플릿: 요약이 본문에 “무조건” 보임
  const template_object = {
    object_type: "text",
    text: safeMsg,
    link: {
      web_url: GMAIL_LINK,
      mobile_web_url: GMAIL_LINK,
    },
    button_title: "경제뉴스 라벨 열기",
  };

  const postOnce = async (accessToken) => {
    return axios.post(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
      new URLSearchParams({ template_object: JSON.stringify(template_object) }).toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  };

  try {
    const res = await postOnce(token);
    LAST_SENT_HASH = h;
    LAST_SENT_AT = now;
    return res.data;
  } catch (e) {
    const data = e?.response?.data;

    if (data?.code === -401 || (typeof data?.msg === "string" && data.msg.includes("expired"))) {
      console.log("🔄 카카오 토큰 만료 → refresh_token으로 갱신 중...");
      await refreshKakaoToken();

      const retry = await postOnce(process.env.KAKAO_ACCESS_TOKEN);
      LAST_SENT_HASH = h;
      LAST_SENT_AT = now;
      return retry.data;
    }

    throw e;
  }
}

module.exports = { sendToKakao, refreshKakaoToken };