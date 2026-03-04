require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

console.log("🔥 kakao.js LOADED");

const ENV_PATH = path.join(process.cwd(), ".env");

// ====== .env 업데이트(로컬용) ======
function updateEnvKey(key, value) {
    // GitHub Actions 환경에서는 파일 업데이트 생략해도 됨
    // (Actions는 Secrets로 주입되므로 .env가 없거나 수정해도 의미 없음)
    if (!fs.existsSync(ENV_PATH)) return;

    const raw = fs.readFileSync(ENV_PATH, "utf8");
    const lines = raw.split(/\r?\n/);

    let found = false;
    const next = lines.map((line) => {
        if (line.startsWith(`${key}=`)) {
            found = true;
            return `${key}=${value}`;
        }
        return line;
    });

    if (!found) next.push(`${key}=${value}`);
    fs.writeFileSync(ENV_PATH, next.join("\n"), "utf8");
}

// ====== 카카오 토큰 갱신 ======
async function refreshKakaoToken() {
    const clientId = process.env.KAKAO_CLIENT_ID;
    const refreshToken = process.env.KAKAO_REFRESH_TOKEN;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET; // 있으면 사용

    if (!clientId) throw new Error("KAKAO_CLIENT_ID가 없습니다. (.env 또는 GitHub Secrets)");
    if (!refreshToken) throw new Error("KAKAO_REFRESH_TOKEN이 없습니다. (.env 또는 GitHub Secrets)");

    const body = new URLSearchParams();
    body.append("grant_type", "refresh_token");
    body.append("client_id", clientId);
    body.append("refresh_token", refreshToken);

    // ✅ 카카오 콘솔에서 '클라이언트 시크릿'을 활성화한 경우 필요할 수 있음
    if (clientSecret) body.append("client_secret", clientSecret);

    const res = await axios.post("https://kauth.kakao.com/oauth/token", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
    });

    const { access_token, refresh_token } = res.data;

    // access_token 갱신
    if (access_token) {
        process.env.KAKAO_ACCESS_TOKEN = access_token;
        // 로컬이면 .env에도 저장
        updateEnvKey("KAKAO_ACCESS_TOKEN", access_token);
    }

    // refresh_token이 새로 내려오는 경우도 있음(가끔)
    if (refresh_token) {
        process.env.KAKAO_REFRESH_TOKEN = refresh_token;
        updateEnvKey("KAKAO_REFRESH_TOKEN", refresh_token);
    }

    return res.data;
}

// ====== 카카오 나에게 보내기(텍스트) ======
async function sendToKakao(text) {
    const accessToken = process.env.KAKAO_ACCESS_TOKEN;
    if (!accessToken) throw new Error("KAKAO_ACCESS_TOKEN이 없습니다. 먼저 발급/갱신이 필요합니다.");

    // 카카오 메시지 API는 폼데이터로 template_object(JSON 문자열) 전달
    const templateObject = {
        object_type: "text",
        text: text?.toString?.() ?? "",
        link: {
            web_url: "https://mail.google.com",       // ✅ 버튼 눌렀을 때 gmail로
            mobile_web_url: "https://mail.google.com" // ✅ 모바일도 gmail로
        },
        button_title: "Gmail 열기",
    };

    const body = new URLSearchParams();
    body.append("template_object", JSON.stringify(templateObject));

    return axios.post("https://kapi.kakao.com/v2/api/talk/memo/default/send", body.toString(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
    });
}

// ====== 안전한 전송 Wrapper (만료면 갱신 후 재시도) ======
async function sendToKakaoSafe(text) {
    try {
        const res = await sendToKakao(text);
        return res.data;
    } catch (e) {
        const data = e?.response?.data;

        // 카카오 토큰 만료 케이스 (대표: -401 / msg expired)
        const isExpired =
            data?.code === -401 ||
            data?.msg?.includes?.("expired") ||
            data?.msg?.includes?.("this access token is already expired");

        if (isExpired) {
            console.log("📌 카카오 토큰 만료 → refresh_token으로 갱신 중...");
            await refreshKakaoToken();
            const res2 = await sendToKakao(text);
            return res2.data;
        }

        // 그 외 에러는 원인 보이게 던짐(토큰/키는 노출 X)
        throw new Error(
            `Kakao send failed: ${data?.error || ""} ${data?.error_description || ""} (code: ${data?.code || ""} ${data?.error_code || ""})`
        );
    }
}

module.exports = {
    refreshKakaoToken,
    sendToKakao: sendToKakaoSafe,
};