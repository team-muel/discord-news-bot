import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
import sys
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv
from discord.ext import tasks

load_dotenv()

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 1. 초기 설정 및 클라이언트 준비
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID_RAW = os.getenv("TARGET_CHANNEL_ID")
AUTOMATION_INTERVAL_MIN = max(1, int(os.getenv("AUTOMATION_JOB_INTERVAL_MIN") or os.getenv("AUTOMATION_NEWS_INTERVAL_MIN") or "30"))
DAEMON_MODE = "--daemon" in sys.argv

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_KEY must be set in environment")
if not DISCORD_TOKEN:
    raise SystemExit("DISCORD_TOKEN must be set in environment")
if not TARGET_CHANNEL_ID_RAW:
    raise SystemExit("TARGET_CHANNEL_ID must be set in environment")

try:
    TARGET_CHANNEL_ID = int(TARGET_CHANNEL_ID_RAW)
except ValueError:
    raise SystemExit("TARGET_CHANNEL_ID must be an integer")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
ai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def fallback_analysis(title: str):
    lowered = title.lower()

    sector_rules = [
        ("세계전쟁상황", ["전쟁", "교전", "미사일", "중동", "우크라", "러시아", "이스라엘", "이란", "군사", "휴전"]),
        ("금리", ["금리", "fomc", "fed", "연준", "기준금리", "국채", "채권"]),
        ("물가", ["물가", "cpi", "ppi", "인플레", "인플레이션", "소비자물가"]),
        ("반도체", ["반도체", "메모리", "hbm", "파운드리", "엔비디아", "삼성전자", "sk하이닉스"]),
        ("부동산", ["부동산", "아파트", "주택", "분양", "전세", "재건축", "재개발"]),
    ]

    sector = "세계전쟁상황"
    for candidate, keywords in sector_rules:
        if any(keyword in lowered for keyword in keywords):
            sector = candidate
            break

    positive_words = ["상승", "회복", "개선", "호재", "완화", "증가", "안정", "돌파"]
    negative_words = ["하락", "급락", "악화", "위기", "불안", "긴장", "충돌", "침체", "경고"]

    score = 0
    for word in positive_words:
        if word in lowered:
            score += 1
    for word in negative_words:
        if word in lowered:
            score -= 1

    if score == 0:
        score = -1 if sector == "세계전쟁상황" else 1

    score = max(-5, min(5, score))
    summary = f"{sector} 관련 핵심 이슈: {title}"
    return {"sector": sector, "sentiment_score": score, "summary": summary}

async def main():
    log("1단계: 강화된 AI 심리 분석 시작 (섹터: 세계전쟁상황 업데이트)")
    
    # [수정] 검색 키워드에 '전쟁', '교전', '이란', '중동' 등을 추가하여 관련 뉴스를 유도합니다.
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR "세계전쟁" OR "전쟁" OR "교전" OR "이란")'
    rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    # 유효 섹터 정의
    valid_sectors = ["금리", "물가", "반도체", "부동산", "세계전쟁상황"]

    for entry in feed.entries[:15]:
        try:
            if ai_client:
                response = ai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{
                        "role": "user", 
                        "content": f"""
                        다음 뉴스 제목을 분석해서 경제/국제 섹터를 분류하고 '시장 심리 점수'를 매겨줘.
                        제목: {entry.title}
                        
                        [채점 규칙]
                        1. 섹터: 금리, 물가, 반도체, 부동산, 세계전쟁상황 중 하나.
                        * 전쟁, 군사 충돌, 중동 정세 등은 반드시 '세계전쟁상황'으로 분류해.
                        2. sentiment_score: -5(매우 심각한 악재/불안)에서 5(엄청난 호재/안정) 사이의 정수. 
                        * 아주 사소한 영향이라도 있다면 0점 대신 1이나 -1을 줘. 중립(0)은 가급적 피할 것.
                        3. summary: 기사 내용을 한 문장으로 요약.
                        
                        반드시 아래 JSON 형식으로만 답해:
                        {{"sector": "분류", "sentiment_score": 숫자, "summary": "요약"}}
                        """
                    }],
                    response_format={ "type": "json_object" }
                )
                # 안전한 JSON 파싱 및 값 검증
                try:
                    ai_content = response.choices[0].message.content
                    ai_res = json.loads(ai_content)
                except Exception as e:
                    log(f"   ⚠️ AI 응답 파싱 실패, 폴백 사용: {e}")
                    ai_res = fallback_analysis(entry.title)
            else:
                ai_res = fallback_analysis(entry.title)

            sector = ai_res.get('sector')
            if sector in valid_sectors:
                raw_score = ai_res.get('sentiment_score', 0)
                try:
                    score = int(float(raw_score))
                except Exception:
                    score = 0
                # 점수 범위 제한
                score = max(-5, min(5, score))

                summary = ai_res.get('summary', '분석 완료')
                res = supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": score,
                    "summary": summary,
                    "source": entry.link
                }).execute()
                # 간단한 결과 체크
                try:
                    if hasattr(res, 'status_code') and res.status_code >= 400:
                        log(f"   ⚠️ DB 저장 실패 status={getattr(res, 'status_code', 'unknown')}")
                    else:
                        save_count += 1
                        log(f"   ✅ DB 저장: [{sector}] 심리점수: {score}점")
                except Exception:
                    save_count += 1
                    log(f"   ✅ DB 저장(확인 불가): [{sector}] 심리점수: {score}점")
        except Exception as e:
            log(f"   ⚠️ 오류: {e}")
            continue

    if save_count == 0:
        log("❌ 신규 데이터 없음")
        return

    return valid_sectors


async def send_report(dc: discord.Client, sectors):
    log("2단계: 디스코드 리포트 카드 발송")
    ch = dc.get_channel(TARGET_CHANNEL_ID)
    if not ch:
        ch = await dc.fetch_channel(TARGET_CHANNEL_ID)

    if not ch:
        log("❌ 채널 접근 실패")
        return

    await ch.send("📊 **AI 경제/국제 정세 분석 리포트**")
    for s in sectors:
        res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
        if res.data:
            item = res.data[0]
            score = int(item['sentiment_score'])

            if score > 0:
                color = 0x2ecc71
            elif score < 0:
                color = 0xe74c3c
            else:
                color = 0x95a5a6

            embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)

            gauge = "🟦" * (score + 5) if score >= 0 else "🟥" * (score + 5)
            embed.add_field(name="AI 심리 지수", value=f"**{score}점**\n{gauge}")

            await ch.send(embed=embed)

    log("[DAEMON] report sent")


async def run_cycle(dc: discord.Client):
    sectors = await main()
    if sectors:
        await send_report(dc, sectors)
    log("[DAEMON] tick complete")


async def run_once_mode():
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        try:
            await run_cycle(dc)
        finally:
            await dc.close()

    await dc.start(DISCORD_TOKEN)


async def run_daemon_mode():
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @tasks.loop(minutes=AUTOMATION_INTERVAL_MIN)
    async def periodic_job():
        await run_cycle(dc)

    @dc.event
    async def on_ready():
        log(f"[DAEMON] news-analysis connected, interval={AUTOMATION_INTERVAL_MIN}m")
        if not periodic_job.is_running():
            periodic_job.start()
        await run_cycle(dc)

    await dc.start(DISCORD_TOKEN)

if __name__ == "__main__":
    if not OPENAI_API_KEY:
        log("OPENAI_API_KEY missing: using fallback analysis mode")
    if DAEMON_MODE:
        asyncio.run(run_daemon_mode())
    else:
        asyncio.run(run_once_mode())
