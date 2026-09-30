/**
 * ScanQuiz Soru İçe Aktarma Motoru (FileParser)
 * 
 * - Excel / CSV / TXT tablolarını okur
 * - PDF veya metin dosyalarından otomatik soru-şık-cevap formatını algılar
 * - %100 istemci tarafında çalışır (sunucusuz, çevrimdışı uyumlu)
 */

/**
 * CSV / TXT formatındaki soru tablosunu parse eder.
 * Desteklenen sütun formatları:
 * Soru;A;B;C;D;Cevap
 * veya
 * Soru,A,B,C,D,Cevap
 */
export function parseCSVQuestions(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(';') ? ';' : (lines[0].includes('\t') ? '\t' : ',');
  const questions = [];

  // Başlık satırı olup olmadığını kontrol et
  let startIndex = 0;
  const firstCols = lines[0].split(delimiter).map(c => c.trim().toLowerCase());
  if (firstCols.some(c => c.includes('soru') || c.includes('question') || c.includes('cevap'))) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const rawCols = lines[i].split(delimiter);
    if (rawCols.length < 5) continue;

    const cols = rawCols.map(c => c.replace(/^["']|["']$/g, '').trim());

    const questionText = cols[0];
    const optA = cols[1] || 'Seçenek A';
    const optB = cols[2] || 'Seçenek B';
    const optC = cols[3] || 'Seçenek C';
    const optD = cols[4] || 'Seçenek D';
    let correct = (cols[5] || 'A').toUpperCase().trim();

    if (!['A', 'B', 'C', 'D'].includes(correct)) {
      if (correct.includes('A')) correct = 'A';
      else if (correct.includes('B')) correct = 'B';
      else if (correct.includes('C')) correct = 'C';
      else if (correct.includes('D')) correct = 'D';
      else correct = 'A';
    }

    questions.push({
      id: questions.length + 1,
      text: questionText,
      options: {
        A: optA,
        B: optB,
        C: optC,
        D: optD
      },
      correctAnswer: correct,
      durationSec: 45
    });
  }

  return questions;
}

/**
 * Yapılandırılmamış metin veya PDF metninden soruları Regex ile ayıklar.
 * Format örneği:
 * 1. Türkiye'nin başkenti neresidir?
 * A) İstanbul
 * B) Ankara
 * C) İzmir
 * D) Bursa
 * Cevap: B
 */
export function parseTextQuestions(rawText) {
  const cleanText = rawText.replace(/\r/g, '');
  const questions = [];

  // Soru bloklarını tespit et (ör. "1.", "1-", "Soru 1:", vb.)
  const questionBlocks = cleanText.split(/(?=(?:^|\n)\s*(?:\d+[\.\-\)]|Soru\s*\d+[\:\.\-]))/i)
    .map(b => b.trim())
    .filter(b => b.length > 15);

  for (let block of questionBlocks) {
    try {
      // 1. Doğru cevabı bul
      let correct = 'A';
      const ansMatch = block.match(/(?:Cevap|Yanıt|Doğru\s*Cevap|Answer)\s*[\:\-\=]?\s*([A-D])/i);
      if (ansMatch) {
        correct = ansMatch[1].toUpperCase();
      }

      // 2. Şıkları bul (A), B), C), D) veya A., B., C., D.)
      const optAMatch = block.match(/(?:^|\n)\s*[A|a][\.\)\-]\s*([^\n]+)/);
      const optBMatch = block.match(/(?:^|\n)\s*[B|b][\.\)\-]\s*([^\n]+)/);
      const optCMatch = block.match(/(?:^|\n)\s*[C|c][\.\)\-]\s*([^\n]+)/);
      const optDMatch = block.match(/(?:^|\n)\s*[D|d][\.\)\-]\s*([^\n]+)/);

      // Soru kökünü şıklardan önceki kısım olarak al
      let questionText = block;
      if (optAMatch) {
        const aIndex = block.indexOf(optAMatch[0]);
        questionText = block.substring(0, aIndex).trim();
      }

      // Baştaki "1.", "Soru 1:" vb. temizle
      questionText = questionText.replace(/^\s*(?:\d+[\.\-\)]|Soru\s*\d+[\:\.\-]?)\s*/i, '').trim();

      if (questionText.length > 3) {
        questions.push({
          id: questions.length + 1,
          text: questionText,
          options: {
            A: optAMatch ? optAMatch[1].trim() : 'A Seçeneği',
            B: optBMatch ? optBMatch[1].trim() : 'B Seçeneği',
            C: optCMatch ? optCMatch[1].trim() : 'C Seçeneği',
            D: optDMatch ? optDMatch[1].trim() : 'D Seçeneği',
          },
          correctAnswer: correct,
          durationSec: 45
        });
      }
    } catch (e) {
      console.warn('Soru bloğu parse hatası:', e);
    }
  }

  return questions;
}

/**
 * Dosya tipine göre okuma ve ayrıştırma yapar.
 */
export async function parseQuizFile(file) {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
    const text = await file.text();
    const csvResult = parseCSVQuestions(text);
    if (csvResult.length > 0) return csvResult;
    return parseTextQuestions(text);
  }

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    // Excel XML text veya CSV dönüşümü
    const text = await file.text();
    const csvResult = parseCSVQuestions(text);
    if (csvResult.length > 0) return csvResult;
    return parseTextQuestions(text);
  }

  if (fileName.endsWith('.pdf')) {
    // PDF metin içerik okuyucu (tarayıcı içi ArrayBuffer decode)
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const rawContent = decoder.decode(buffer);
    
    // PDF içindeki metin akışlarını (BT ... ET) yakala
    const matches = rawContent.match(/\((.*?)\)\s*T[jJ]/g) || [];
    let extractedText = '';
    for (const m of matches) {
      const clean = m.replace(/^\(|\)\s*T[jJ]$/g, '');
      extractedText += clean + ' ';
    }

    if (extractedText.trim().length > 30) {
      return parseTextQuestions(extractedText);
    }

    // Basit metin olarak da dene
    return parseTextQuestions(rawContent);
  }

  throw new Error('Desteklenmeyen dosya formatı. Lütfen CSV, TXT, Excel veya PDF yükleyin.');
}
