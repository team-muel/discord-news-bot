import os
import sys
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# 로그 즉시 출력을 위한 설정
print("1. 환경 변수 로드 시작...", flush=True)
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

print("2. 클라이언트 초기화 중...", flush=True)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_KEY)

async def collect_and_analyze():
    print("3. 뉴스 수집 및 AI 분석 시작...", flush=True)
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    if not feed.entries:
        print("⚠️ 수집된 기사가 없습니다.", flush=True)
        return

    # 속도를 위해 10개만 분석
    for entry in feed.entries[:10]:
        try:
            print(f"🔎 분석 중: {entry.title[:20]}...", flush=True)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"제목: {entry.title}\n5대 섹터(금리, 물가, 반도체, 부동산, 유행) JSON 분류."}],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            if ai_res.get('sector') in ["금리", "물가", "반도체", "부동산", "유행"]:
                supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": ai_res['sector'],
                    "sentiment_score": int(round(float(ai_res.get('sentiment_score', 0)))),
                    "summary": ai_res.get('summary', ''),
                    "source": entry.link
                }).execute()
                print(f"   ✅ {ai_res['sector']} 저장 완료", flush=True)
        except Exception as e:
            print(f"   ❌ 오류 발생: {e}", flush=True)
            continue

async def main():
    # 뉴스 분석 먼저 수행
    await collect_and_analyze()
    
    print("4. 디스코드 접속 시도...", flush=True)
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        print(f"5. 디스코드 로그인 성공: {dc.user}", flush=True)
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("🗞️ **[GitHub] 오늘의 5대 섹터 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=0x3498db)
                    await ch.send(embed=embed)
            print("6. 리포트 전송 완료!", flush=True)
        await dc.close()

    try:
        # 로그인 시도 시간을 30초로 제한 (무한 대기 방지)
        await asyncio.wait_for(dc.start(DISCORD_TOKEN), timeout=30.0)
    except asyncio.TimeoutError:
        print("⚠️ 디스코드 로그인 시간이 초과되었습니다. (네트워크 지연)", flush=True)
    except Exception as e:
        print(f"❌ 디스코드 오류: {e}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
