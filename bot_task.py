import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 1. 초기 설정 및 클라이언트 준비
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID_RAW = os.getenv("TARGET_CHANNEL_ID")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_KEY must be set in environment")
if not OPENAI_API_KEY:
    raise SystemExit("OPENAI_API_KEY must be set in environment")
if not DISCORD_TOKEN:
    raise SystemExit("DISCORD_TOKEN must be set in environment")
if not TARGET_CHANNEL_ID_RAW:
    raise SystemExit("TARGET_CHANNEL_ID must be set in environment")

try:
    TARGET_CHANNEL_ID = int(TARGET_CHANNEL_ID_RAW)
except ValueError:
    raise SystemExit("TARGET_CHANNEL_ID must be an integer")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

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
            response = client.chat.completions.create(
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
                log(f"   ⚠️ AI 응답 파싱 실패: {e}")
                continue

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

    log("2단계: 디스코드 리포트 카드 발송")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("📊 **AI 경제/국제 정세 분석 리포트**")
            for s in valid_sectors:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    score = int(item['sentiment_score'])
                    
                    if score > 0: color = 0x2ecc71 
                    elif score < 0: color = 0xe74c3c 
                    else: color = 0x95a5a6 
                    
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)
                    
                    gauge = "🟦" * (score + 5) if score >= 0 else "🟥" * (score + 5)
                    embed.add_field(name="AI 심리 지수", value=f"**{score}점**\n{gauge}")
                    
                    await ch.send(embed=embed)
        await dc.close()

    await dc.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
