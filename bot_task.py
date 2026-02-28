import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# 로그 출력 함수 (실시간 확인용)
def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 초기 설정 및 클라이언트 준비
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

async def main():
    # --- [1단계: 뉴스 분석 및 Supabase 저장] ---
    log("1단계 시작: 뉴스 수집 및 AI 분석/저장")
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    for entry in feed.entries[:15]:
        try:
            # AI에게 섹터 판단 요청
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user", 
                    "content": f"제목: {entry.title}\n5대 섹터(금리, 물가, 반도체, 부동산, 유행) 중 하나로 분류하고 요약해. 반드시 JSON 형식으로 답해."
                }],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector')
            
            # 지정된 5개 섹터에 해당할 때만 DB 저장
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": int(round(float(ai_res.get('sentiment_score', 0)))),
                    "summary": ai_res.get('summary', ''),
                    "source": entry.link
                }).execute()
                save_count += 1
                log(f"   ✅ DB 저장 완료: [{sector}] {entry.title[:15]}...")
        except Exception as e:
            log(f"   ❌ 분석/저장 오류 무시: {e}")
            continue

    log(f"1단계 종료: 총 {save_count}건 저장 완료")

    # --- [2단계: 디스코드 로그인 및 데이터 전송] ---
    if save_count == 0:
        log("⚠️ 저장된 데이터가 없어 디스코드 전송을 생략합니다.")
        return

    log("2단계 시작: 디스코드 로그인 및 리포트 발송")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        log(f"디스코드 로그인 성공: {dc.user}")
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        
        if ch:
            await ch.send("🗞️ **[GitHub Actions] 오늘의 5대 섹터 핵심 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                # 방금 저장한 따끈따끈한 데이터를 섹터별로 1개씩 호출
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    score = item['sentiment_score']
                    color = 0x2ecc71 if score > 0 else 0xe74c3c if score < 0 else 0x95a5a6
                    
                    embed = discord.Embed(
                        title=f"[{item['sector']}] {item['title']}", 
                        description=item['summary'], 
                        url=item['source'], 
                        color=color
                    )
                    embed.add_field(name="AI 심리 지수", value=f"**{score}점**")
                    await ch.send(embed=embed)
                    log(f"   📤 {s} 섹터 전송 완료")
            
            log("모든 리포트 발송 완료!")
        
        # 전송 후 깔끔하게 종료
        await dc.close()

    # 디스코드 실행
    try:
        await dc.start(DISCORD_TOKEN)
    except Exception as e:
        log(f"❌ 디스코드 실행 오류: {e}")

if __name__ == "__main__":
    asyncio.run(main())
