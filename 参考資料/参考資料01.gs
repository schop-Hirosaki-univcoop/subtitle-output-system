function checkRemainingQuota(){
  var remainingQuota = MailApp.getRemainingDailyQuota();
  Logger.log("今日送信できる残りのメール数： " + remainingQuota);

  if(remainingQuota === 0){
    Logger.log("Over...");
  }
}

function extractFormattedDate(text) {
  const match = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (match) {
    let month = parseInt(match[1], 10) - 1; // JavaScriptの月は0始まり
    let day = parseInt(match[2], 10);
    let date = new Date(2025, month, day);

    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    let weekday = weekdays[date.getDay()];

    return `${match[1]}月${match[2]}日(${weekday})`; // "4月2日(水)" の形式
  }
  return null;
}

function sendWelcomeEmails() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("送信するデータ"); // シート名を適宜変更
  const data = sheet.getDataRange().getValues(); // スプレッドシートのデータを取得
  const subject = "【重要】新入生Welcome Party 2025参加日時の確認"; // メールの件名
  
  for (let i = 1; i < data.length; i++) { // 1行目（ヘッダー）はスキップ
    let name = data[i][3]; // B列: 名前
    let email = data[i][7]; // B列: メールアドレス
    let dateText = data[i][9];  // C列: 参加日
    let sentFlag = data[i][10];  // I列: 送信フラグ

    if (!email || sentFlag === 1) continue; // メールアドレスが空 or 送信済みならスキップ

    let formattedDate = extractFormattedDate(dateText); 

let contactEmail = "gakui.hirosaki@gmail.com"; // 問い合わせ用のメールアドレス

let htmlBody = `
  <html>
  <head>
    <style>
      body {
        font-family: 'Arial', 'Helvetica', 'Meiryo', 'sans-serif';
        line-height: 1.6;
        color: #333333;
        background-color: #f9f9f9;
        padding: 20px;
      }
      .container {
        max-width: 600px;
        margin: auto;
        background: #e0e0e0;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .header {
        font-size: 20px;
        font-weight: bold;
        color: #0077cc;
        text-align: center;
        margin-bottom: 20px;
      }
      .highlight {
        font-size: 18px;
        font-weight: bold;
        color: #cc0000;
      }
      .info {
        font-size: 16px;
        margin-bottom: 10px;
      }
      .date-box {
        background: #f0f0f0;
        color: #ee2222;
        font-size: 40px;
        font-weight: bold;
        text-align: center;
        padding: 10px;
        border-radius: 8px;
        margin: 15px auto;
        width: 80%;
      }
      .button {
        display: inline-block;
        background: #44bbff;
        color: #eeeeee;
        padding: 12px 20px;
        text-decoration: none;
        border-radius: 5px;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        margin-top: 15px;
      }
      .button:hover {
        background: #005fa3;
      }
      .footer {
        font-size: 14px;
        text-align: center;
        margin-top: 20px;
        color: #555555;
      }
    </style>
    <meta charset="UTF-8">

  </head>
  <body>
    <div class="container">
      <p class="header">新入生Welcome Party 2025参加日時の確認</p>
      <p class="info">こんにちは！ ${name} 様</p>
      <p class="info">
        今回は<strong>「新入生Welcome Party 2025」</strong>にご参加いただきありがとうございます！
      </p>
      <p class="info">
        <strong>${name} 様の参加日は以下の通りです：</strong>
      </p>
      <div class="date-box">${formattedDate}</div>
      <p class="info">
        当日は<strong>弘前大学の大学会館３階 大集会室</strong>で開催します。<br>
        <strong>17:00-17:30</strong>までの間にお越しください！
      </p>
      <hr>
      <p class="info">
        受付の際に本人確認のため、<strong>本メール画面</strong>を見せていただく場合がございます。<br>
        あらかじめ<strong>スクリーンショットのご用意</strong>をお願いします。
      </p>
      <hr>
      <p class="info">
        事情があって会に参加できなくなった場合や、質問がある場合は、下のボタンからお問い合わせください。
      </p>
      <p style="text-align: center;">
        <a href="mailto:${contactEmail}" class="button">お問い合わせする</a>
      </p>
      <p class="footer">
        それでは、みなさんに会えるのをお待ちしています！
      </p>
      <p class="footer">
        弘前大学生協学生委員会<br>
        新入生Welcome Party 2025運営チーム
      </p>
    </div>
  </body>
  </html>`;

//        <br><br>
//        また、当日は会の様子のアルバム撮影がございます<br>
//        あらかじめご了承ください。


let rawMessage = "To: " + email + "\r\n" +
                 "Subject: =?UTF-8?B?" + Utilities.base64Encode(Utilities.newBlob(subject).getBytes()) + "?=\r\n" +
                 "MIME-Version: 1.0\r\n" +
                 "Content-Type: text/html; charset=UTF-8\r\n" +
                 "Content-Transfer-Encoding: base64\r\n\r\n" +
                 Utilities.base64Encode(Utilities.newBlob(htmlBody).getBytes());
      
      let message = {
        "raw": Utilities.base64EncodeWebSafe(rawMessage)
      };

    try {
      Utilities.sleep(1500);
      Gmail.Users.Messages.send(message, "me");

//      MailApp.sendEmail({
//        to: email,
//        subject: subject,
//        htmlBody: htmlBody
//      });
//      GmailApp.createDraft(email, subject, '', {htmlBody: htmlBody});

      console.log(`${name} 様 (${email}) への送信成功`);
      sheet.getRange(i + 1, 11).setValue(1); // I列（9列目）に1をセット
    } catch (error) {
      console.error(`${name} 様 (${email}) への送信失敗: ${error.message}`);
      Logger.log(error.stack); // エラーの詳細な情報を記録
      return;
    }
  }
}

function sendSurveyEmailsToAbsentees() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("送信するデータ");
  const data = sheet.getDataRange().getValues();
  const subject = "【欠席者向けアンケートのお願い】Welcome Party 2025について";
  
  for (let i = 1; i < data.length; i++) { // 1行目（ヘッダー）はスキップ
    let name = data[i][3];        // D列: 名前
    let email = data[i][7];       // H列: メールアドレス
    let dateText = data[i][9];    // J列：参加日
    let absent = data[i][12];     // M列: 欠席
    let canceled = data[i][13];   // N列: キャンセル
    let sentFlag = data[i][14];   // O列: アンケート送信済みフラグ

    if ((!absent && !canceled) || !email || sentFlag === 1) continue;

    let formattedDate = extractFormattedDate(dateText); 

let surveyUrl = "https://forms.gle/c46fkYwpeSBNLDda8"; // アンケートURL
let contactEmail = "gakui.hirosaki@gmail.com"; // 問い合わせ用のメールアドレス

let htmlBody = `
  <html>
  <head>
    <style>
      body {
        font-family: 'Arial', 'Helvetica', 'Meiryo', 'sans-serif';
        line-height: 1.6;
        color: #333333;
        background-color: #f9f9f9;
        padding: 20px;
      }
      .container {
        max-width: 600px;
        margin: auto;
        background: #e0e0e0;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .header {
        font-size: 20px;
        font-weight: bold;
        color: #0077cc;
        text-align: center;
        margin-bottom: 20px;
      }
      .highlight {
        font-size: 18px;
        font-weight: bold;
        color: #cc0000;
      }
      .info {
        font-size: 16px;
        margin-bottom: 10px;
      }
      .date-box {
        background: #f0f0f0;
        color: #0077cc;
        font-size: 40px;
        font-weight: bold;
        text-align: center;
        padding: 10px;
        border-radius: 8px;
        margin: 15px auto;
        width: 80%;
      }
      .button {
        display: inline-block;
        background: #44bbff;
        color: #eeeeee;
        padding: 12px 20px;
        text-decoration: none;
        border-radius: 5px;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        margin-top: 15px;
      }
      .button:hover {
        background: #005fa3;
      }
      .button2 {
        display: inline-block;
        background: #ff44bb;
        color: #eeeeee;
        padding: 12px 20px;
        text-decoration: none;
        border-radius: 5px;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        margin-top: 15px;
      }
      .button2:hover {
        background: #a3005f;
      }
      .footer {
        font-size: 14px;
        text-align: center;
        margin-top: 20px;
        color: #555555;
      }
    </style>
    <meta charset="UTF-8">

  </head>
<div class="container">
  <p class="header">【欠席者向けアンケートのお願い】Welcome Party 2025について</p>
  <p class="info">${name} 様</p>
  <p class="info">
    このたびは <strong>Welcome Party 2025</strong> にお申込いただき、誠にありがとうございました。
  </p>
  <p class="info">
    残念ながらご欠席とのことでしたが、以下の日程で参加予定としてご登録いただいておりました。
  </p>
  <div class="date-box">${formattedDate}</div>
  <p class="info">
    今後の企画や運営をより良いものにしていくため、<strong>簡単なアンケート</strong>へのご協力をお願いしております。
  </p>
  <p class="info">
    ご回答は<strong>任意</strong>ですが、いただいたご意見は来年以降のイベント運営に活かしてまいります。
  </p>
  <p class="info">
    所要時間は <strong>1～2分程度</strong>です。以下のボタンからご回答いただけます。
  </p>
  <p style="text-align: center;">
    <a href="${surveyUrl}" class="button2">アンケートに回答する</a>
  </p>
  <p class="info">
  当アンケートには<strong>4月23日（火）</strong>までにご回答いただけますと幸いです。
</p>
<p class="info">
  大変恐縮ではございますが、今後の準備や集計の都合上、<strong>短めの回答期間</strong>となっておりますこと、何卒ご理解いただけますと幸いです。
</p>
<p class="info">
  ※システムの仕様上、同じ方に複数のメールが届く場合がございますが、<strong>ご回答は1回のみ</strong>で差し支えありません。
</p>
  <hr>
  <p class="info">
    ご質問やご不明点がございましたら、以下のメールまでお気軽にお問い合わせください。
  </p>
  <p style="text-align: center;">
    <a href="mailto:${contactEmail}" class="button">お問い合わせ</a>
  </p>
  <p class="footer">
    またご縁がございましたら、弘前大学生協学生委員会の企画にご参加いただけますと幸いでございます。<br>
    弘前大学生協学生委員会<br>
    Welcome Party 2025運営チーム
  </p>
</div>
  </html>`;

let rawMessage = "To: " + email + "\r\n" +
                 "Subject: =?UTF-8?B?" + Utilities.base64Encode(Utilities.newBlob(subject).getBytes()) + "?=\r\n" +
                 "MIME-Version: 1.0\r\n" +
                 "Content-Type: text/html; charset=UTF-8\r\n" +
                 "Content-Transfer-Encoding: base64\r\n\r\n" +
                 Utilities.base64Encode(Utilities.newBlob(htmlBody).getBytes());
      
      let message = {
        "raw": Utilities.base64EncodeWebSafe(rawMessage)
      };

    try {
      Utilities.sleep(1500);
      Gmail.Users.Messages.send(message, "me");

      console.log(`${name} 様 (${email}) への送信成功`);
      sheet.getRange(i + 1, 15).setValue(1); // O列に1(送信フラグ)をセット
    } catch (error) {
      console.error(`${name} 様 (${email}) への送信失敗: ${error.message}`);
      Logger.log(error.stack); // エラーの詳細な情報を記録
      return;
    }
  }
}

function exportDuplicateMatrixSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const nameMap = new Map(); // 名前ごとに各シートのデータを格納

  // 対象シートのリストを収集（"送信済み"で始まるシート）
  const targetSheets = sheets.filter(sheet => sheet.getName().startsWith("送信済み"));
  const sheetNames = targetSheets.map(sheet => sheet.getName());

  // 各シートを走査してデータ格納
  targetSheets.forEach(sheet => {
    const sheetName = sheet.getName();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const name = data[i][3];        // D列: 名前
      const furigana = data[i][4];    // E列: フリガナ
      const remarks = data[i][11];    // L列: 備考（0-indexed）
      const absence = data[i][12];    // M列: 欠席
      const cancel = data[i][13];     // N列: キャンセル

      if (!name) continue;

      if (!nameMap.has(name)) {
        nameMap.set(name, { furigana, sheets: {} });
      }

      const entry = nameMap.get(name);
      entry.sheets[sheetName] = {
        remarks,
        absence,
        cancel
      };
    }
  });

  // 重複者のみに絞る
  const duplicates = Array.from(nameMap.entries()).filter(([_, value]) => Object.keys(value.sheets).length > 1);

  // 出力先の準備
  const outputSheetName = "重複者一覧";
  let outputSheet = ss.getSheetByName(outputSheetName);
  if (outputSheet) {
    outputSheet.clearContents();
  } else {
    outputSheet = ss.insertSheet(outputSheetName);
  }

  // ヘッダー作成
  let header = ["名前", "フリガナ"];
  sheetNames.forEach(name => {
    header.push(name);                    // ○×判定
    header.push(`備考（${name}）`);
    header.push(`欠席（${name}）`);
    header.push(`キャンセル（${name}）`);
  });
  outputSheet.appendRow(header);

  // 各重複者のデータ行を作成
  duplicates.forEach(([name, value]) => {
    const row = [name, value.furigana || ""];
    sheetNames.forEach(sheetName => {
      const data = value.sheets[sheetName];
      if (data) {
        row.push("○");
        row.push(data.remarks || "");
        row.push(data.absence || "");
        row.push(data.cancel || "");
      } else {
        row.push("×");
        row.push("");
        row.push("");
        row.push("");
      }
    });
    outputSheet.appendRow(row);
  });

  Logger.log(`重複者 ${duplicates.length} 件を「${outputSheetName}」にマトリックス形式で出力しました。`);
}
