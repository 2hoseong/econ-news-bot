require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { authorize } = require("./auth");
const { sendToKakao } = require("./kakao");
const { summarizeNews } = require("./summarize");

// base64url 디코딩 (Gmail 본문)
function decodeBase64Url(data) {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  return Buffer.from(padded, "base64").toString("utf-8");
}

// 라벨 이름 -> 라벨 ID 찾기
async function findLabelId(gmail, labelName) {
  const res = await gmail.users.labels.list({ userId: "me" });
  const label = res.data.labels?.find((l) => l.name === labelName);
  return label?.id || null;
}

// 메일 payload에서 텍스트 뽑기 (text/plain 우선, 없으면 html 태그 제거)
function extractTextFromPayload(payload) {
  const stack = [payload];
  let plain = "";
  let html = "";

  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;

    const mimeType = part.mimeType;
    const bodyData = part.body?.data;

    if (mimeType === "text/plain" && bodyData) plain += "\n" + decodeBase64Url(bodyData);
    if (mimeType === "text/html" && bodyData) html += "\n" + decodeBase64Url(bodyData);

    if (part.parts?.length) for (const p of part.parts) stack.push(p);
  }

  if (!plain && html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return plain.trim();
}

async function main() {
  const auth = await authorize();
  const gmail = google.gmail({ version: "v1", auth });

  const labelName = "경제뉴스";
  const labelId = await findLabelId(gmail, labelName);
  if (!labelId) throw new Error(`라벨 '${labelName}' 를 Gmail에서 찾지 못했습니다.`);

  // 최근 1일 이내 + 라벨 경제뉴스
  const list = await gmail.users.messages.list({
    userId: "me",
    labelIds: [labelId],
    q: "newer_than:1d",
    maxResults: 5,
  });

  const messages = list.data.messages || [];
  if (messages.length === 0) {
    console.log("오늘(1일 이내) '경제뉴스' 라벨 메일이 없습니다.");
    return;
  }

  let out = `📩 오늘의 경제뉴스 메일 ${messages.length}건\n`;

  for (const m of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const subject = headers.find((h) => h.name === "Subject")?.value || "(제목없음)";
    const from = headers.find((h) => h.name === "From")?.value || "(발신자없음)";
    const snippet = (detail.data.snippet || "").replace(/\s+/g, " ").trim();

    out += `\n- ${subject}\n  From: ${from}\n  Snippet: ${snippet}\n`;
  }

  console.log("전송 내용:\n", out);
  const summary = await summarizeNews(out);

  const message = `📌 오늘의 경제 뉴스 요약 (3~5줄)\n\n${summary}`;

  const kakaoRes = await sendToKakao(message);
  console.log("✅ 카카오 전송 결과:", kakaoRes);
}

main().catch((e) => {
  console.error("❌ 에러:", e?.response?.data || e);
  process.exit(1);
});