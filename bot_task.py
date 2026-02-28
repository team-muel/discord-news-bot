import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# 로그 출력 강화
def log(msg):
    print(msg, flush=True)

log("1. 환경 변수 로드...")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_KEY)

async def collect_and_analyze():
    log("2. 뉴스 분석 시작 (DB 저장)...")
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    if not feed.entries: return

    for entry in feed.entries[:12]: # 분석 개수 최적화
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"제목: {entry.title}\n5대 섹터(금리, 물가, 반도체, 부동산, 유행) JSON 분류."}],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector')
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": int(round(float(ai_res.get('sentiment_score', 0)))),
                    "summary": ai_res.get('summary', ''),
                    "source": entry.link
                }).execute()
                log(f"   ✅ {sector} 저장 완료")
        except: continue

async def main():
    # 뉴스 분석은 로그인과 별개로 먼저 끝냄
    await collect_and_analyze()
    
    log("3. 디스코드 접속 및 리포트 전송...")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        log(f"🤖 로그인 성공: {dc.user}")
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("🗞️ **[GitHub] 오늘의 5대 섹터 핵심 리포트**")
            sectors = ["금리", "물가", "반도체", "부동산", "유행"]
            for s in sectors:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    score = item['sentiment_score']
                    color = 0x2ecc71 if score > 0 else 0xe74c3c if score < 0 else 0x95a5a6
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)
                    embed.add_field(name="심리 지수", value=f"**{score}점**")
                    await ch.send(embed=embed)
                    log(f"   📤 {s} 리포트 발송")
                    await asyncio.sleep(1) # 전송 안정성 확보
            log("🏁 모든 전송이 완료되었습니다.")
        await dc.close()

    # 타임아웃을 2분으로 대폭 늘려 안정성 확보
    try:
        await asyncio.wait_for(dc.start(DISCORD_TOKEN), timeout=120.0)
    except Exception as e:
        log(f"⚠️ 전송 과정 중 알림: {e}")

if __name__ == "__main__":
    asyncio.run(main())
