import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 1. 초기화
log("환경 변수 로드 및 클라이언트 준비")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def start_process():
    # 2. 뉴스 분석 및 DB 저장 (디스코드 로그인 전에 미리 다 끝냄)
    log("뉴스 분석 및 DB 작업 시작...")
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    
    for entry in feed.entries[:12]:
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
                log(f"✅ DB 저장: {sector}")
        except: continue

    # 3. 분석이 다 끝난 후에만 디스코드 접속
    log("전송을 위해 디스코드 접속 시도...")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        log(f"디스코드 로그인 성공! 리포트 발송 시작")
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("🗞️ **[GitHub Actions] 오늘의 5대 핵심 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    color = 0x2ecc71 if item['sentiment_score'] > 0 else 0xe74c3c
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)
                    embed.add_field(name="심리 점수", value=f"{item['sentiment_score']}점")
                    await ch.send(embed=embed)
                    log(f"📤 {s} 발송 완료")
        
        log("모든 미션 완료. 강제 종료합니다.")
        os._exit(0) # 디스코드 라이브러리의 루프를 무시하고 강제 종료

    # 로그인 시도 (최대 60초 대기)
    try:
        await dc.start(DISCORD_TOKEN)
    except Exception as e:
        log(f"⚠️ 디스코드 연결 실패: {e}")
        os._exit(1)

if __name__ == "__main__":
    asyncio.run(start_process())
