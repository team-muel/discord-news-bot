import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# 설정 로드
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_KEY)

async def run_news_collection():
    print("🚀 뉴스 수집 시작...")
    # 주요 경제지 쿼리 (속도를 위해 분석 개수를 15개로 제한)
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    if not feed or not feed.entries:
        print("⚠️ 기사가 없습니다.")
        return

    # 딱 상위 15개만 분석해서 시간을 단축합니다.
    for entry in feed.entries[:15]:
        prompt = f"제목: {entry.title}\n5대 섹터(금리, 물가, 반도체, 부동산, 유행) 중 하나로 분류하고 JSON으로 답해."
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini", # 속도가 더 빠른 mini 모델 권장
                messages=[{"role": "user", "content": prompt + ' {"sector": "분류", "sentiment_score": 정수, "summary": "1요약"}'}],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector', '기타')
            
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                data = {
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": int(round(float(ai_res.get('sentiment_score', 0)))),
                    "summary": ai_res.get('summary', ''),
                    "source": entry.link
                }
                supabase.table("news_sentiment").insert(data).execute()
                print(f"✅ 저장: {sector}")
        except: continue

async def main():
    await run_news_collection()
    
    intents = discord.Intents.default()
    discord_client = discord.Client(intents=intents)

    @discord_client.event
    async def on_ready():
        channel = discord_client.get_channel(TARGET_CHANNEL_ID)
        if channel:
            sectors = ["금리", "물가", "반도체", "부동산", "유행"]
            await channel.send("🗞️ **오늘의 5대 섹터 리포트 (GitHub 자동배달)**")
            for s in sectors:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    color = 0x2ecc71 if item['sentiment_score'] > 0 else 0xe74c3c
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], color=color, url=item['source'])
                    await channel.send(embed=embed)
        print("🏁 전송 완료.")
        await discord_client.close()

    await discord_client.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
