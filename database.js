import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

export async function initDB() {
  db = await open({
    filename: "./distriquiz.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      score INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
  `);

  try {
    await db.exec("ALTER TABLE questions ADD COLUMN quiz_id INTEGER REFERENCES quizzes(id)");
  } catch {
    // column already exists
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER REFERENCES quizzes(id),
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL
    );
  `);

  await seedDefaultQuizzes(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS directory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logical_path TEXT UNIQUE NOT NULL,
      ufid TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  const adminCount = await db.get("SELECT COUNT(*) AS cnt FROM admins");
  if (adminCount.cnt === 0) {
    await db.run(
      "INSERT INTO admins (username, password) VALUES (?, ?)",
      "mohammed", "moh123"
    );
    console.log("Default admin created: mohammed / moh123");
  }

  console.log("Database initialized: distriquiz.db");
  return db;
}

async function seedDefaultQuizzes(db) {
  try {
    const quizCount = await db.get("SELECT COUNT(*) as count FROM quizzes");
    if (quizCount.count > 0) {
      console.log("[Database] Database already seeded. Skipping initial data population.");
      return;
    }

    console.log("[Database] Database is empty. Seeding default Arabic quizzes and questions...");

    await db.run("BEGIN TRANSACTION");

    const quizzes = [
      { id: 1, title: "نباتات" },
      { id: 2, title: "حيوانات" },
      { id: 3, title: "تاريخ" },
      { id: 4, title: "جغرافيا" },
      { id: 5, title: "دين" },
      { id: 6, title: "علوم" },
      { id: 7, title: "فلك" },
      { id: 8, title: "برمجة" }
    ];

    for (const quiz of quizzes) {
      await db.run("INSERT INTO quizzes (id, title) VALUES (?, ?)", [quiz.id, quiz.title]);
    }

    const questions = [
      { quiz_id: 1, text: "ما هو النبات الأسرع نمواً على وجه الأرض؟", a: "الخيزران (البامبو)", b: "شجر الصنوبر", c: "شجر النخيل", d: "شجر الزيتون", correct: "A" },
      { quiz_id: 1, text: "أي جزء من النبات يقوم بعملية التمثيل الضوئي بشكل رئيسي؟", a: "الجذور", b: "الأوراق", c: "الأزهار", d: "الساق", correct: "B" },
      { quiz_id: 1, text: "ما هي المادة الكيميائية التي تعطي النباتات لونها الأخضر؟", a: "الميلانين", b: "الكيراتين", c: "الكلوروفيل", d: "الهيموجلوبين", correct: "C" },
      { quiz_id: 1, text: "ما هي أكبر زهرة في العالم من حيث الحجم؟", a: "زهرة الأوركيد", b: "زهرة عباد الشمس", c: "زهرة اللوتس", d: "رافليسيا أرنولدية", correct: "D" },
      { quiz_id: 1, text: "أي من النباتات التالية يعتبر من آكلات اللحوم (صائدة الحشرات)؟", a: "خناق الذباب (ديونيا)", b: "نبات الصبار", c: "نبات النعناع", d: "شجرة البلوط", correct: "A" },
      { quiz_id: 1, text: "ما هي الشجرة التي تعتبر أضخم وأقدم شجرة حية عملاقة على الأرض؟", a: "النخلة", b: "السكويا العملاقة", c: "السدرة", d: "الأرز", correct: "B" },
      { quiz_id: 1, text: "شجرة الزيتون تعتبر في الثقافة العالمية رمزاً لـ؟", a: "القوة", b: "الغنى", c: "السلام", d: "العلم", correct: "C" },
      { quiz_id: 1, text: "ما هو النبات الذي يستخرج منه السكر بشكل رئيسي بجانب قصب السكر؟", a: "البطاطس", b: "الجزر", c: "الذرة", d: "بنجر السكر", correct: "D" },
      { quiz_id: 1, text: "أي غاز يمتصه النبات من الهواء أثناء عملية البناء الضوئي؟", a: "ثاني أكسيد الكربون", b: "الأكسجين", c: "النيتروجين", d: "الهيدروجين", correct: "A" },
      { quiz_id: 1, text: "ما هو العضو المسؤول عن امتصاص الماء والمواد المغذية من التربة للنبات؟", a: "الساق", b: "الجذور", c: "الأوراق", d: "الثمار", correct: "B" },
      { quiz_id: 2, text: "ما هو أسرع حيوان بري في العالم؟", a: "الفهد الصياد (الشيتا)", b: "الأسد", c: "الغزال", d: "الحصان البري", correct: "A" },
      { quiz_id: 2, text: "ما هو أكبر ثديي مائي وعلى وجه الأرض بالكامل؟", a: "قرش الحوت", b: "الحوت الأزرق", c: "الفيل الآسيوي", d: "حوت الأوركا", correct: "B" },
      { quiz_id: 2, text: "كم قلباً يمتلك كائن الأخطبوط المائي؟", a: "قلب واحد", b: "قلبان", c: "ثلاثة قلوب", d: "أربعة قلوب", correct: "C" },
      { quiz_id: 2, text: "ما هو الحيوان الذي يلقب بـ 'سفينة الصحراء' لقدرته العالية على التحمل؟", a: "الحصان", b: "الحمار الوحشي", c: "الفهد", d: "الجمل", correct: "D" },
      { quiz_id: 2, text: "أي من الحيوانات التالية يمتلك أقوى عضة مسجلة علمياً؟", a: "التمساح", b: "الأسد", c: "الذئب", d: "الدب الرمادي", correct: "A" },
      { quiz_id: 2, text: "ما هو الطائر الوحيد الذي يستطيع الطيران إلى الخلف؟", a: "الصقر", b: "الطائر الطنان", c: "البومة", d: "النعامة", correct: "B" },
      { quiz_id: 2, text: "ما هو الحيوان البحري الذي لا ينام أبداً طوال حياته؟", a: "الدلفين", b: "نجم البحر", c: "القرش", d: "قنديل البحر", correct: "C" },
      { quiz_id: 2, text: "كم عدد أذرع نجم البحر في الغالب؟", a: "ثمانية أذرع", b: "عشرة أذرع", c: "ستة أذرع", d: "خمسة أذرع", correct: "D" },
      { quiz_id: 2, text: "ما هو أثقل وأكبر حيوان بري يعيش حالياً؟", a: "الفيل الأفريقي", b: "الخرتيت", c: "الزرافة", d: "فرس النهر", correct: "A" },
      { quiz_id: 2, text: "أي من الكائنات التالية ينتمي إلى طائفة الزواحف وليس البرمائيات؟", a: "الضفدع", b: "الثعبان", c: "السمندل", d: "السلمندر", correct: "B" },
      { quiz_id: 3, text: "من هو القائد المسلم الذي قاد جيوش فتح الأندلس؟", a: "طارق بن زياد", b: "خالد بن الوليد", c: "صلاح الدين الأيوبي", d: "عقبة بن نافع", correct: "A" },
      { quiz_id: 3, text: "في أي عام اندلعت الحرب العالمية الأولى؟", a: "1939م", b: "1914م", c: "1918م", d: "1945م", correct: "B" },
      { quiz_id: 3, text: "من بني الأهرامات الثلاثة الكبرى في مصر القديمة؟", a: "الإغريق", b: "الرومان", c: "الفراعنة المصريون القدماء", d: "الآشوريون", correct: "C" },
      { quiz_id: 3, text: "ما هي عاصمة الدولة العباسية في أوج ازدهارها الإسلامي؟", a: "دمشق", b: "القاهرة", c: "المدينة المنورة", d: "بغداد", correct: "D" },
      { quiz_id: 3, text: "من هو المكتشف الجغرافي الذي ينسب إليه اكتشاف قارة أمريكا؟", a: "كريستوفر كولومبوس", b: "فاسكو دا غاما", c: "ماجلان", d: "ابن بطوطة", correct: "A" },
      { quiz_id: 3, text: "متى سقطت الإمبراطورية الرومانية الغربية؟", a: "عام 1453م", b: "عام 476م", c: "عام 1000م", d: "عام 200م", correct: "B" },
      { quiz_id: 3, text: "من هو الإمبراطور الفرنسي الشهير الذي قاد حملات واسعة في أوروبا مطلع القرن الـ19؟", a: "لويس الرابع عشر", b: "شارلمان", c: "نابليون بونابرت", d: "يوليوس قيصر", correct: "C" },
      { quiz_id: 3, text: "في أي مدينة فرنسية شهيرة يقع متحف اللوفر الأثري؟", a: "مارسيليا", b: "ليون", c: "نيس", d: "باريس", correct: "D" },
      { quiz_id: 3, text: "ما هي الحرب التاريخية التي استمرت أكثر من قرن بين فرنسا وإنجلترا؟", a: "حرب المئة عام", b: "حرب الوردتين", c: "حرب الثلاثين عاماً", d: "الحرب الباردة", correct: "A" },
      { quiz_id: 3, text: "من هو الملك البابلي الشهير بوضع أول ميثاق قوانين مكتوب في التاريخ؟", a: "نبوخذ نصر", b: "حمورابي", d: "سنحاريب", c: "سرجون الأكدي", correct: "B" },
      { quiz_id: 4, text: "ما هو أطول نهر مائي في العالم؟", a: "نهر النيل", b: "نهر الأمازون", c: "نهر الميسيسيبي", d: "نهر اليانغتسي", correct: "A" },
      { quiz_id: 4, text: "ما هي أكبر قارة في العالم من حيث المساحة وعدد السكان؟", a: "أفريقيا", b: "آسيا", c: "أوروبا", d: "أمريكا الشمالية", correct: "B" },
      { quiz_id: 4, text: "ما هي أصغر دولة مستقلة في العالم من حيث المساحة؟", a: "موناكو", b: "المالديف", c: "الفاتيكان", d: "سان مارينو", correct: "C" },
      { quiz_id: 4, text: "في أي قارة تقع الصحراء الكبرى، أكبر صحراء حارة في العالم؟", a: "آسيا", b: "أستراليا", c: "أمريكا الجنوبية", d: "أفريقيا", correct: "D" },
      { quiz_id: 4, text: "ما هي أعلى قمة جبلية على وجه الأرض؟", a: "جبل إفرست", b: "جبل كليمنجارو", c: "جبل مون بلان", d: "جبل كي تو", correct: "A" },
      { quiz_id: 4, text: "ما هي عاصمة دولة اليابان حالياً؟", a: "بكين", b: "طوكيو", c: "سول", d: "كيوتو", correct: "B" },
      { quiz_id: 4, text: "أي بحر يفصل جغرافياً بين قارتي أفريقيا وأوروبا؟", a: "البحر الأحمر", b: "البحر الأسود", c: "البحر الأبيض المتوسط", d: "بحر قزوين", correct: "C" },
      { quiz_id: 4, text: "ما هي الدولة التي تمتلك أكبر عدد سكان في العالم حالياً؟", a: "الولايات المتحدة", b: "إندونيسيا", c: "روسيا", d: "الهند", correct: "D" },
      { quiz_id: 4, text: "ما هو أعمق محيط مائي على وجه الأرض؟", a: "المحيط الهادئ", b: "المحيط الأطلسي", c: "المحيط الهندي", d: "المحيط المتجمد الشمالي", correct: "A" },
      { quiz_id: 4, text: "ما هي عاصمة جمهورية مصر العربية التاريخية والحالية؟", a: "الإسكندرية", b: "القاهرة", c: "الأقصر", d: "أسوان", correct: "B" },
      { quiz_id: 5, text: "كم عدد سور القرآن الكريم كاملة؟", a: "114 سورة", b: "110 سور", c: "120 سورة", d: "115 سورة", correct: "A" },
      { quiz_id: 5, text: "من هو النبي الذي لُقب وعُرف بـ 'كليم الله'؟", a: "إبراهيم عليه السلام", b: "موسى عليه السلام", c: "عيسى عليه السلام", d: "نوح عليه السلام", correct: "B" },
      { quiz_id: 5, text: "ما هي أول قبلة توجه إليها المسلمون في الصلاة قبل الكعبة؟", a: "المسجد الحرام", b: "المسجد النبوي", c: "المسجد الأقصى", d: "مسجد قِباء", correct: "C" },
      { quiz_id: 5, text: "في أي مدينة مباركة ولد الرسول محمد صلى الله عليه وسلم؟", a: "المدينة المنورة", b: "الطائف", c: "القدس", d: "مكة المكرمة", correct: "D" },
      { quiz_id: 5, text: "ما هي أطول سورة قرآنية في المصحف الشريف؟", a: "سورة البقرة", b: "سورة آل عمران", c: "سورة النساء", d: "سورة المائدة", correct: "A" },
      { quiz_id: 5, text: "كم عدد أركان الإسلام الخمسة الأساسية؟", a: "ستة أركان", b: "خمسة أركان", c: "سبعة أركان", d: "أربعة أركان", correct: "B" },
      { quiz_id: 5, text: "من هو الصحابي الجليل الذي لقب بـ 'الفاروق'؟", a: "أبو بكر الصديق", b: "عثمان بن عفان", c: "عمر بن الخطاب", d: "علي بن أبي طالب", correct: "C" },
      { quiz_id: 5, text: "ما هي أول غزوة ومعركة كبرى خاضها المسلمون في التاريخ ضد قريش؟", a: "غزوة أحد", b: "غزوة الخندق", c: "غزوة خيبر", d: "غزوة بدر", correct: "D" },
      { quiz_id: 5, text: "ما هو الكتاب السماوي الذي أنزل وصحح به عيسى عليه السلام؟", a: "الإنجيل", b: "التوراة", c: "الزبور", d: "الفرقان", correct: "A" },
      { quiz_id: 5, text: "كم عدد رسل أولي العزم المذكورين في القرآن الكريم؟", a: "ثلاثة رسل", b: "خمسة رسل", c: "ستة رسل", d: "أربعة رسل", correct: "B" },
      { quiz_id: 6, text: "ما هو العنصر الكيميائي الأكثر وفرة وانتشاراً في الكون؟", a: "الهيدروجين", b: "الأكسجين", c: "النيتروجين", d: "الكربون", correct: "A" },
      { quiz_id: 6, text: "ما هو كوكب النظام الشمسي الأكثر سخونة وحرارة؟", a: "عطارد", b: "الزهرة", c: "المريخ", d: "المشتري", correct: "B" },
      { quiz_id: 6, text: "ما هو المكون والمادة الأساسية لتصنيع الزجاج؟", a: "الحديد", b: "الرخام", c: "الرمل (السيليكا)", d: "الفحم", correct: "C" },
      { quiz_id: 6, text: "أي من الغازات التالية ضروري وأساسي لتنفس وحياة الكائنات الحية البرية؟", a: "النيتروجين", b: "ثاني أكسيد الكربون", c: "الهيليوم", d: "الأكسجين", correct: "D" },
      { quiz_id: 6, text: "ما هي وحدة قياس شدة التيار الكهربائي في الفيزياء؟", a: "الأمبير", b: "الفولت", c: "الوات", d: "الأوم", correct: "A" },
      { quiz_id: 6, text: "من هو العالم والمخترع الذي ينسب إليه اختراع المصباح الكهربائي العملي؟", a: "نيقولا تسلا", b: "توماس إيديسون", c: "جراهام بيل", d: "ألبيرت أينشتاين", correct: "B" },
      { quiz_id: 6, text: "ما هي القوة الفيزيائية التي تجذب الأجسام والكتل نحو الأرض؟", a: "القوة المغناطيسية", b: "القوة الطاردة", c: "قوة الجاذبية", d: "قوة الاحتكاك", correct: "C" },
      { quiz_id: 6, text: "ما هو المعدن الوحيد الذي يتواجد في حالة سائلة في درجة حرارة الغرفة؟", a: "الحديد", b: "النحاس", c: "الألومنيوم", d: "الزئبق", correct: "D" },
      { quiz_id: 6, text: "كم عدد العظام التقريبي في الهيكل العظمي للإنسان البالغ؟", a: "206 عظمة", b: "150 عظمة", c: "300 عظمة", d: "250 عظمة", correct: "A" },
      { quiz_id: 6, text: "ما هي فصيلة الدم التي يطلق عليها لقب 'المتبرع العام' لإمكانية إعطائها للجميع؟", a: "A موجبة", b: "O سالبة", c: "AB موجبة", d: "B سالبة", correct: "B" },
      { quiz_id: 7, text: "ما هو الكوكب الأقرب موقعاً إلى الشمس في مجموعتنا؟", a: "عطارد", b: "الزهرة", c: "الأرض", d: "المريخ", correct: "A" },
      { quiz_id: 7, text: "ما هو الكوكب الذي يشتهر بحلقاته الغبارية الضخمة الواضحة حوله؟", a: "أورانوس", b: "زحل", c: "نبتون", d: "المشتري", correct: "B" },
      { quiz_id: 7, text: "كم يستغرق ضوء الشمس تقريباً للوصول إلى كوكب الأرض؟", a: "ساعة واحدة", b: "ثانية واحدة", c: "8 دقائق", d: "24 دقيقة", correct: "C" },
      { quiz_id: 7, text: "ما هو أكبر كواكب مجموعتنا الشمسية بأكملها من حيث القطر والكتلة؟", a: "زحل", b: "الأرض", c: "الزهرة", d: "المشتري", correct: "D" },
      { quiz_id: 7, text: "ما هي المجرة الكونية التي ينتمي إليها نظامنا الشمسي وكوكب الأرض؟", a: "درب التبانة", b: "أندروميدا (المرأة المسلسلة)", c: "مجرة غيوم ماجلان", d: "مجرة المثلث", correct: "A" },
      { quiz_id: 7, text: "أي كوكب من الكواكب يلقب ويشتهر باسم 'الكوكب الأحمر'؟", a: "عطارد", b: "المريخ", c: "الزهرة", d: "زحل", correct: "B" },
      { quiz_id: 7, text: "ما هو النجم المركزي والوحيد في نظامنا الكوكبي؟", a: "سيريس", b: "نجم القطب", c: "الشمس", d: "الشعرى اليمانية", correct: "C" },
      { quiz_id: 7, text: "ما هي القوة الفيزيائية التي تبقي الكواكب في مداراتها حول الشمس؟", a: "الاحتكاك الكوني", b: "الضغط الشمسي", c: "المغناطيسية", d: "الجاذبية الشديدة للشمس", correct: "D" },
      { quiz_id: 7, text: "ما هي الظاهرة الفلكية التي تحدث عندما يقع القمر تماماً بين الأرض والشمس؟", a: "كسوف الشمس", b: "خسوف القمر", c: "الاعتدال الخريفي", d: "تساقط الشهب", correct: "A" },
      { quiz_id: 7, text: "كم عدد كواكب المجموعة الشمسية المعترف بها رسمياً حالياً؟", a: "تسعة كواكب", b: "ثمانية كواكب", c: "عشرة كواكب", d: "سبعة كواكب", correct: "B" },
      { quiz_id: 8, text: "ما هي لغة البرمجة المستخدمة بشكل أساسي لإضافة التفاعلية لصفحات الويب؟", a: "جافا سكريبت (JavaScript)", b: "لغة C++", c: "لغة HTML", d: "لغة CSS", correct: "A" },
      { quiz_id: 8, text: "ما هي قاعدة البيانات خفيفة الوزن المخزنة في ملف واحد التي نستخدمها في مشروعنا الحالي؟", a: "MongoDB", b: "SQLite", c: "PostgreSQL", d: "Oracle", correct: "B" },
      { quiz_id: 8, text: "ماذا يعني الاختصار الشهير لمطوري الويب 'HTML'؟", a: "Home Tool Markup Language", b: "Hyperlink Text Management", c: "HyperText Markup Language", d: "High Technology Modern Language", correct: "C" },
      { quiz_id: 8, text: "أي رمز مما يلي يستخدم لكتابة تعليقات من سطر واحد في لغة JavaScript؟", a: "#", b: "/*", c: "<!--", d: "//", correct: "D" },
      { quiz_id: 8, text: "ما هي الكلمة المفتاحية المستخدمة لتعريف متغير ثابت غير قابل للتعديل في لغة JavaScript؟", a: "const", b: "let", c: "var", d: "static", correct: "A" },
      { quiz_id: 8, text: "ما هي المنصة السحابية والبرمجية الأشهر عالمياً لإدارة إصدارات الأكواد البرمجية؟", a: "Docker", b: "Git / GitHub", c: "Nginx", d: "Jenkins", correct: "B" },
      { quiz_id: 8, text: "أي بروتوكول يُستخدم لنقل صفحات ومحتويات الويب بشكل آمن ومشفر؟", a: "FTP", b: "SMTP", c: "HTTPS", d: "HTTP", correct: "C" },
      { quiz_id: 8, text: "ما هي الصيغة النصية والقياسية الأكثر شهرة لتبادل البيانات على شبكة الويب؟", a: "CSV", b: "YAML", c: "TXT", d: "JSON", correct: "D" },
      { quiz_id: 8, text: "ما هي الدالة البرمجية القياسية لطباعة نصوص واختبار الأكواد في لوحة تحكم المتصفح (Console)؟", a: "console.log()", b: "print()", c: "echo()", d: "document.write()", correct: "A" },
      { quiz_id: 8, text: "ما هو نوع البيانات (Data Type) الذي يمثل قيمتين فقط 'صح' أو 'خطأ' في البرمجة؟", a: "String (نصي)", b: "Boolean (بوليان)", c: "Integer (رقمي)", d: "Array (مصفوفة)", correct: "B" }
    ];

    for (const q of questions) {
      await db.run(
        "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [q.quiz_id, q.text, q.a, q.b, q.c, q.d, q.correct]
      );
    }

    await db.run("COMMIT");
    console.log("[Database] Successfully seeded 8 Arabic quizzes with 80 trivia questions total!");

  } catch (error) {
    await db.run("ROLLBACK");
    console.error("[Database Error] Seeding process failed. Rolled back changes.", error);
  }
}

export function sanitizeInput(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[<>"']/g, "")
    .replace(/&/g, "")
    .trim()
    .substring(0, 30);
}

export async function getRandomQuestions(limit = 5) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions ORDER BY RANDOM() LIMIT ?",
    limit
  );
}

export async function getQuizList() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT id, question_text FROM questions ORDER BY id"
  );
}

export async function getPlayerStats(limit = 10) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT username, score FROM players ORDER BY score DESC LIMIT ?",
    limit
  );
}

export async function getAllQuizzes() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(`
    SELECT q.id, q.title, COUNT(qs.id) AS question_count
    FROM quizzes q
    LEFT JOIN questions qs ON qs.quiz_id = q.id
    GROUP BY q.id
    ORDER BY q.id
  `);
}

export async function insertQuiz(title) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  const result = await db.run("INSERT INTO quizzes (title) VALUES (?)", title);
  return result.lastID;
}

export async function getQuizById(quizId) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.get("SELECT id, title FROM quizzes WHERE id = ?", quizId);
}

export async function insertQuestion(quizId, questionText, optionA, optionB, optionC, optionD, correctOption) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  const result = await db.run(
    "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
    quizId, questionText, optionA, optionB, optionC, optionD, correctOption
  );
  return result.lastID;
}

export async function getQuestionsByQuizId(quizId) {
  if (!db) throw new Error("Database not initialized.");
  return db.all(
    "SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions WHERE quiz_id = ? ORDER BY id",
    quizId
  );
}

export async function deleteQuiz(quizId) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  await db.run("DELETE FROM questions WHERE quiz_id = ?", quizId);
  await db.run("DELETE FROM quizzes WHERE id = ?", quizId);
}

export async function verifyAdmin(username, password) {
  if (!db) throw new Error("Database not initialized.");
  const row = await db.get(
    "SELECT id FROM admins WHERE username = ? AND password = ?",
    username, password
  );
  return !!row;
}

export function getDB() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db;
}
