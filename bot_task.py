import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# GitHub Secrets에서 보안 키 로드
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_KEY)

async def run_news_collection():
    print("🔎 주요 경제지 헤드라인 분석 및 DB 저장 시작...")
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    if not feed.entries: return

    for entry in feed.entries[:30]:
        prompt = f"제목: {entry.title}\n분류: 금리/물가/반도체/부동산/유행 중 하나(없으면 기타)\n반드시 JSON 형식으로 응답."
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt + ' {"sector": "분류", "sentiment_score": 정수, "summary": "요약"}'}],
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
                print(f"✅ 저장 완료: [{sector}] {entry.title[:15]}...")
        except: continue

async def main():
    # 1. 뉴스 수집
    await run_news_collection()
    
    # 2. 디스코드 전송
    intents = discord.Intents.default()
    discord_client = discord.Client(intents=intents)

    @discord_client.event
    async def on_ready():
        channel = discord_client.get_channel(TARGET_CHANNEL_ID)
        if channel:
            sectors = ["금리", "물가", "반도체", "부동산", "유행"]
            await channel.send("🗞️ **[GitHub 자동 배달] 오늘의 5대 핵심 리포트**")
            for sector in sectors:
                res = supabase.table("news_sentiment").select("*").eq("sector", sector).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    color = 0x2ecc71 if item['sentiment_score'] > 0 else 0xe74c3c
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], color=color, url=item['source'])
                    embed.add_field(name="심리 점수", value=f"{item['sentiment_score']}점")
                    await channel.send(embed=embed)
        await discord_client.close()

    await discord_client.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
