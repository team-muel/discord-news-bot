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

# 초기 설정
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

async def main():
    log("1단계: 강화된 AI 심리 분석 시작")
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    for entry in feed.entries[:15]:
        try:
            # AI에게 더 구체적인 채점 가이드라인을 제공합니다.
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user", 
                    "content": f"""
                    다음 뉴스 제목을 분석해서 경제 섹터를 분류하고 '시장 심리 점수'를 매겨줘.
                    제목: {entry.title}
                    
                    [채점 규칙]
                    1. 섹터: 금리, 물가, 반도체, 부동산, 유행 중 하나.
                    2. sentiment_score: -5(매우 심각한 악재)에서 5(엄청난 호재) 사이의 정수. 
                    * 아주 사소한 영향이라도 있다면 0점 대신 1이나 -1을 줘. 중립(0)은 가급적 피할 것.
                    3. summary: 기사 내용을 한 문장으로 요약.
                    
                    반드시 아래 JSON 형식으로만 답해:
                    {{"sector": "분류", "sentiment_score": 숫자, "summary": "요약"}}
                    """
                }],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector')
            
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                # 문자열로 올 경우를 대비해 확실하게 숫자로 변환
                raw_score = ai_res.get('sentiment_score', 0)
                score = int(float(raw_score))
                
                supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": score,
                    "summary": ai_res.get('summary', '분석 완료'),
                    "source": entry.link
                }).execute()
                save_count += 1
                log(f"   ✅ DB 저장: [{sector}] 심리점수: {score}점")
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
            await ch.send("📊 **AI 경제 섹터 분석 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                # 방금 저장한 가장 최신 데이터를 가져옵니다.
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    score = int(item['sentiment_score'])
                    
                    # 색상 로직 개선
                    if score > 0: color = 0x2ecc71 # 초록
                    elif score < 0: color = 0xe74c3c # 빨강
                    else: color = 0x95a5a6 # 회색
                    
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)
                    
                    # 게이지 형태의 시각화 효과 추가
                    gauge = "🟦" * (score + 5) if score >= 0 else "🟥" * (score + 5)
                    embed.add_field(name="AI 심리 지수", value=f"**{score}점**\n{gauge}")
                    
                    await ch.send(embed=embed)
        await dc.close()

    await dc.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
