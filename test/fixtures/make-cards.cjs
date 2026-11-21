// テスト用の名刺画像を生成（架空の人物・企業）
const { chromium } = require('playwright');
const path = require('path');
const cards = [
  { file: 'card1.png', html: `<div class="c"><div class="co">株式会社サンプル商事</div><div class="dp">営業部 部長</div><div class="nm">山田 太郎</div><div class="kn">ヤマダ タロウ</div><div class="ad">〒100-0001 東京都千代田区千代田1-1-1</div><div class="ad">TEL 03-1234-5678　taro.yamada@example.co.jp</div></div>` },
  { file: 'card2.png', html: `<div class="c"><div class="co">合同会社テスト技研</div><div class="dp">開発課 主任</div><div class="nm">佐藤 花子</div><div class="ad">〒530-0001 大阪府大阪市北区梅田2-2-2</div><div class="ad">TEL 06-9876-5432</div></div>` },
  { file: 'blank.png', html: `<div class="c"></div>` },
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 910, height: 550 } });
  for (const c of cards) {
    await p.setContent(`<style>body{margin:0}.c{width:910px;height:550px;background:#fff;padding:50px;box-sizing:border-box;font-family:"Noto Sans CJK JP","Noto Sans JP",sans-serif;color:#111}
    .co{font-size:34px;font-weight:700}.dp{font-size:26px;margin-top:40px}.nm{font-size:64px;font-weight:700;margin-top:6px;letter-spacing:4px}.kn{font-size:22px}.ad{font-size:22px;margin-top:14px}</style>${c.html}`);
    await p.screenshot({ path: path.join(__dirname, c.file) });
  }
  await b.close();
})();
