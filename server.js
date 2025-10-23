const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const jwt = require('jsonwebtoken');
const Database = require('./database');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const db = new Database();

// CORS configuration for Socket.io
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud-erp-secret-key-2024';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Create required directories
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'public'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// WhatsApp Client
let whatsappClient;
let isConnected = false;
let qrCodeUrl = '';
let isBotStopped = false;

// User sessions
const activeUsers = new Map();

// Employee Performance Tracking
let employeePerformance = {
    dailyStats: {
        date: new Date().toISOString().split('T')[0],
        messagesSent: 0,
        clientsContacted: 0,
        aiRepliesSent: 0,
        bulkCampaigns: 0,
        interestedClients: 0,
        startTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    },
    clientInteractions: new Map(),
    messageHistory: []
};

// DeepSeek AI Configuration
let deepseekAvailable = false;

console.log('🔑 Initializing DeepSeek AI...');
if (process.env.DEEPSEEK_API_KEY) {
    deepseekAvailable = true;
    console.log('✅ DeepSeek API key found');
} else {
    console.log('❌ DeepSeek API key not found in .env file');
    deepseekAvailable = false;
}

// Client auto-reply timers to prevent spam
let clientReplyTimers = new Map();

// Comprehensive Company Information
const ragmcloudCompanyInfo = {
    name: "رقم كلاود",
    englishName: "Ragmcloud ERP",
    website: "https://ragmcloud.sa",
    phone: "+966555111222",
    email: "info@ragmcloud.sa",
    address: "الرياض - حي المغرزات - طريق الملك عبد الله",
    workingHours: "من الأحد إلى الخميس - 8 صباحاً إلى 6 مساءً",
    
    packages: {
        basic: {
            name: "الباقة الأساسية",
            price: "1000 ريال سنوياً",
            users: "مستخدم واحد",
            branches: "فرع واحد",
            storage: "500 ميجابايت",
            invoices: "500 فاتورة شهرياً",
            features: [
                "إدارة العملاء والفواتير",
                "إدارة المبيعات والمشتريات",
                "إدارة المنتجات",
                "إرسال عروض الأسعار",
                "إرسال الفواتير عبر البريد",
                "دعم فني عبر البريد الإلكتروني",
                "تحديثات النظام الدورية",
                "تصدير التقارير إلى Excel",
                "رفع الفواتير الإلكترونية (فاتورة)",
                "الدعم الفني عبر المحادثة"
            ],
            missing: [
                "إدارة المخزون",
                "التقارير المفصلة",
                "الدعم الفني الهاتفي",
                "إدارة صلاحيات المستخدمين",
                "تطبيق الجوال"
            ],
            target: "الأفراد والمشاريع الصغيرة جداً"
        },
        
        advanced: {
            name: "الباقة المتقدمة", 
            price: "1800 ريال سنوياً",
            users: "مستخدمين",
            branches: "فرعين",
            storage: "1 جيجابايت",
            invoices: "1000 فاتورة شهرياً",
            features: [
                "جميع ميزات الباقة الأساسية",
                "إدارة المخزون المتكاملة",
                "تقارير مفصلة (20 تقرير)",
                "دعم فني عبر الهاتف",
                "إدارة صلاحيات المستخدمين",
                "تطبيق الجوال",
                "الفروع والمستخدمين الفرعيين"
            ],
            missing: [
                "التنبيهات الذكية",
                "الربط مع المتاجر الإلكترونية",
                "إدارة متعددة الفروع",
                "ربط النظام بالمحاسب الخارجي",
                "تخصيص واجهة النظام"
            ],
            target: "الشركات الصغيرة والمتوسطة"
        },
        
        professional: {
            name: "الباقة الاحترافية",
            price: "2700 ريال سنوياً", 
            users: "3 مستخدمين",
            branches: "3 فروع",
            storage: "2 جيجابايت",
            invoices: "2000 فاتورة شهرياً",
            features: [
                "جميع ميزات الباقة المتقدمة",
                "تنبيهات ذكية",
                "الربط مع المتاجر الإلكترونية",
                "إدارة متعددة الفروع",
                "ربط النظام بالمحاسب الخارجي",
                "تخصيص واجهة النظام",
                "30 تقرير متاح",
                "تدريب المستخدمين"
            ],
            missing: [
                "استشارات محاسبية مجانية"
            ],
            target: "الشركات المتوسطة والكبيرة"
        },
        
        premium: {
            name: "الباقة المميزة",
            price: "3000 ريال سنوياً",
            users: "3 مستخدمين", 
            branches: "3 فروع",
            storage: "3 جيجابايت",
            invoices: "غير محدود",
            features: [
                "جميع ميزات الباقة الاحترافية",
                "استشارات محاسبية مجانية",
                "فواتير غير محدودة",
                "دعم متميز"
            ],
            target: "الشركات الكبيرة والمؤسسات"
        }
    }
};

// AI System Prompt (FULL TRAINING)
const AI_SYSTEM_PROMPT = `أنت مساعد ذكي ومحترف تمثل شركة "رقم كلاود" المتخصصة في أنظمة ERP السحابية. أنت بائع مقنع ومحاسب خبير.

🔹 **هويتك:**
- أنت بائع محترف ومحاسب متمرس
- تركيزك على بيع أنظمة ERP وخدمات رقم كلاود فقط
- لا تجيب على أسئلة خارج نطاق تخصصك

🔹 **معلومات الشركة:**
الاسم: رقم كلاود (Ragmcloud ERP)
الموقع: https://ragmcloud.sa  
الهاتف: +966555111222
المقر: الرياض - حي المغرزات

🔹 **باقات الأسعار (سنوية):**
• الباقة الأساسية: 1000 ريال (مستخدم واحد)
• الباقة المتقدمة: 1800 ريال (مستخدمين) 
• الباقة الاحترافية: 2700 ريال (3 مستخدمين)
• الباقة المميزة: 3000 ريال (3 مستخدمين)

🔹 **قواعد الرد الإلزامية:**
1. **لا تجيب أبداً على:** أسئلة شخصية، سياسة، أديان، برامج أخرى، منافسين
2. **إذا سألك عن شيء خارج تخصصك:** قل "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP"
3. **كن مقنعاً:** ركز على فوائد النظام للعميل
4. **اسأل عن نشاط العميل:** لتعرف أي باقة تناسبه
5. **شجع على التواصل:** وجه العميل للاتصال بفريق المبيعات

🔹 **نماذج الردود المقنعة:**
- "نظامنا بيوفر عليك 50% من وقتك اليومي في المتابعة المحاسبية"
- "بتقدر تتابع كل فروعك من مكان واحد بدون ما تحتاج تروح لكل فرع"
- "التقارير بتكون جاهزة بشكل فوري علشان تتابع أداء شركتك"
- "جرب النظام مجاناً لمدة 7 أيام وتشوف الفرق بنفسك"

🔹 **كيفية التعامل مع الأسئلة:**
- اسأل عن طبيعة نشاط العميل أولاً
- حدد التحديات التي يواجهها
- اقترح الباقة المناسبة لاحتياجاته
- وجهه للاتصال بفريق المبيعات للتسجيل

تذكر: أنت بائع محترف هدفك مساعدة العملاء في اختيار النظام المناسب لشركاتهم.`;

// Function to determine if greeting should be sent
function shouldSendGreeting(phone) {
    try {
        const messages = getClientMessages(phone);
        if (messages.length === 0) {
            return true; // First message in conversation
        }
        
        const lastMessage = messages[messages.length - 1];
        const lastMessageTime = new Date(lastMessage.timestamp);
        const currentTime = new Date();
        const hoursDiff = (currentTime - lastMessageTime) / (1000 * 60 * 60);
        
        return hoursDiff > 5;
    } catch (error) {
        console.error('Error checking greeting condition:', error);
        return true;
    }
}

// Check if we should auto-reply to client
function shouldReplyToClient(phone) {
    return true;
}

// Check if we should auto-reply to client (3-second delay)
function shouldAutoReplyNow(phone) {
    const lastReplyTime = clientReplyTimers.get(phone);
    if (!lastReplyTime) return true;
    
    const timeDiff = Date.now() - lastReplyTime;
    return timeDiff >= 3000;
}

// Update client reply timer
function updateReplyTimer(phone) {
    clientReplyTimers.set(phone, Date.now());
}

// Auto-detect client interest based on message content
function autoDetectClientInterest(phone, message) {
    try {
        const msg = message.toLowerCase();
        
        const interestedKeywords = ['سعر', 'تكلفة', 'عرض', 'خصم', 'تجربة', 'جرب', 'مميزات', 'تفاصيل', 'متى', 'كيف', 'أرغب', 'أريد', 'شرح', 'شرح', 'تكلم', 'اتصل', 'تواصل'];
        const busyKeywords = ['لاحقاً', 'مشغول', 'بعدين', 'لاحقا', 'الوقت', 'منشغل', 'مشغول', 'شغل', 'دور', 'وظيفة'];
        const notInterestedKeywords = ['لا أريد', 'غير مهتم', 'لا أرغب', 'شكراً', 'لا شكر', 'ما ابغى', 'ما ابي', 'كفاية', 'توقف', 'لا تتصل', 'بلوك'];
        
        let newStatus = 'no-reply';
        
        if (interestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'interested';
        } else if (busyKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'busy';
        } else if (notInterestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'not-interested';
        }
        
        updateClientStatus(phone, newStatus);
        return newStatus;
    } catch (error) {
        console.error('Error auto-detecting client interest:', error);
        return 'no-reply';
    }
}

// Update client status in memory
function updateClientStatus(phone, status) {
    try {
        db.updateClientStatus(phone, status, null);
        console.log(`🔄 Auto-updated client ${phone} status to: ${status}`);
    } catch (error) {
        console.error('Error updating client status:', error);
    }
}

// Track employee activity
function trackEmployeeActivity(type, data = {}) {
    employeePerformance.dailyStats.lastActivity = new Date().toISOString();
    
    switch (type) {
        case 'message_sent':
            employeePerformance.dailyStats.messagesSent++;
            if (!employeePerformance.clientInteractions.has(data.clientPhone)) {
                employeePerformance.dailyStats.clientsContacted++;
                employeePerformance.clientInteractions.set(data.clientPhone, {
                    firstContact: new Date().toISOString(),
                    messageCount: 0,
                    lastMessage: new Date().toISOString(),
                    interested: false
                });
            }
            const clientData = employeePerformance.clientInteractions.get(data.clientPhone);
            clientData.messageCount++;
            clientData.lastMessage = new Date().toISOString();
            break;
            
        case 'ai_reply':
            employeePerformance.dailyStats.aiRepliesSent++;
            break;
            
        case 'bulk_campaign':
            employeePerformance.dailyStats.bulkCampaigns++;
            break;
            
        case 'client_interested':
            employeePerformance.dailyStats.interestedClients++;
            if (employeePerformance.clientInteractions.has(data.clientPhone)) {
                employeePerformance.clientInteractions.get(data.clientPhone).interested = true;
            }
            break;
    }
    
    employeePerformance.messageHistory.push({
        timestamp: new Date().toISOString(),
        type: type,
        ...data
    });
    
    savePerformanceData();
}

// Save performance data to file
function savePerformanceData() {
    try {
        const performanceData = {
            ...employeePerformance,
            clientInteractions: Array.from(employeePerformance.clientInteractions.entries())
        };
        fs.writeFileSync('./memory/employee_performance.json', JSON.stringify(performanceData, null, 2));
    } catch (error) {
        console.error('Error saving performance data:', error);
    }
}

// Load performance data
function loadPerformanceData() {
    try {
        if (fs.existsSync('./memory/employee_performance.json')) {
            const data = JSON.parse(fs.readFileSync('./memory/employee_performance.json', 'utf8'));
            employeePerformance = {
                ...data,
                clientInteractions: new Map(data.clientInteractions || [])
            };
            
            const today = new Date().toISOString().split('T')[0];
            if (employeePerformance.dailyStats.date !== today) {
                resetDailyStats();
            }
        }
    } catch (error) {
        console.error('Error loading performance data:', error);
        resetDailyStats();
    }
}

// Reset daily statistics
function resetDailyStats() {
    employeePerformance.dailyStats = {
        date: new Date().toISOString().split('T')[0],
        messagesSent: 0,
        clientsContacted: 0,
        aiRepliesSent: 0,
        bulkCampaigns: 0,
        interestedClients: 0,
        startTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    };
    employeePerformance.clientInteractions = new Map();
    employeePerformance.messageHistory = [];
    savePerformanceData();
}

// Get conversation history for AI context
function getConversationHistoryForAI(phone, maxMessages = 10) {
    try {
        const messages = getClientMessages(phone);
        const recentMessages = messages.slice(-maxMessages);
        
        const conversationHistory = recentMessages.map(msg => {
            const role = msg.fromMe ? 'assistant' : 'user';
            return {
                role: role,
                content: msg.message
            };
        });
        
        console.log(`📚 Loaded ${conversationHistory.length} previous messages for context`);
        return conversationHistory;
    } catch (error) {
        console.error('Error getting conversation history:', error);
        return [];
    }
}

// DeepSeek AI API Call with Conversation Memory
async function callDeepSeekAI(userMessage, clientPhone) {
    if (!deepseekAvailable || !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek not available');
    }

    try {
        console.log('🚀 Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        const conversationHistory = getConversationHistoryForAI(clientPhone);
        
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT
            }
        ];

        if (conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

        messages.push({
            role: "user", 
            content: `العميل يقول: "${userMessage}"
            
${shouldGreet ? 'ملاحظة: هذه بداية المحادثة - ابدأ بالتحية المناسبة' : 'المحادثة مستمرة'}

الرد المطلوب (بلهجة البائع المحترف والمقنع):`
        });

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: messages,
                max_tokens: 500,
                temperature: 0.7,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        } else {
            throw new Error('Invalid response from DeepSeek');
        }

    } catch (error) {
        console.error('❌ DeepSeek API Error:', error.message);
        throw error;
    }
}

// Enhanced Ragmcloud responses for when AI fails
function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
    const msg = userMessage.toLowerCase().trim();
    const shouldGreet = shouldSendGreeting(clientPhone);
    
    console.log('🤖 Using enhanced Ragmcloud response for:', msg);
    
    const irrelevantQuestions = [
        'من أنت', 'ما اسمك', 'who are you', 'what is your name',
        'مدير', 'المدير', 'manager', 'owner', 'صاحب',
        'عمرك', 'كم عمرك', 'how old', 'اين تسكن', 'اين تعيش',
        ' politics', 'سياسة', 'دين', 'religion', 'برامج أخرى',
        'منافس', 'منافسين', 'competitor'
    ];
    
    if (irrelevantQuestions.some(q => msg.includes(q))) {
        return "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP. يمكنني مساعدتك في اختيار النظام المناسب لشركتك أو الإجابة على استفساراتك حول باقاتنا وخدماتنا.";
    }
    
    if (shouldGreet && (msg.includes('السلام') || msg.includes('سلام') || msg.includes('اهلا') || 
        msg.includes('مرحبا') || msg.includes('اهلين') || msg.includes('مساء') || 
        msg.includes('صباح') || msg.includes('hello') || msg.includes('hi'))) {
        return `السلام عليكم ورحمة الله وبركاته 🌟

أهلاً وسهلاً بك! أنا مساعدك في نظام رقم كلاود ERP.

أنا هنا لمساعدتك في:
• اختيار الباقة المناسبة لشركتك
• شرح ميزات نظام ERP السحابي
• الإجابة على استفساراتك التقنية والمحاسبية

📞 للاستشارة المجانية: +966555111222
🌐 الموقع: ragmcloud.sa

كيف يمكنني مساعدتك اليوم؟`;
    }
    
    if (msg.includes('سعر') || msg.includes('تكلفة') || msg.includes('باقة') || 
        msg.includes('package') || msg.includes('price') || msg.includes('كم') || 
        msg.includes('كام') || msg.includes('تعرفة')) {
        
        return `🔄 جاري تحميل معلومات الباقات...

✅ **باقات رقم كلاود السنوية:**

🏷️ **الباقة الأساسية** - 1000 ريال/سنوياً
• مستخدم واحد • فرع واحد • 500 فاتورة/شهر

🏷️ **الباقة المتقدمة** - 1800 ريال/سنوياً  
• مستخدمين • فرعين • 1000 فاتورة/شهر

🏷️ **الباقة الاحترافية** - 2700 ريال/سنوياً
• 3 مستخدمين • 3 فروع • 2000 فاتورة/شهر

🏷️ **الباقة المميزة** - 3000 ريال/سنوياً
• 3 مستخدمين • 3 فروع • فواتير غير محدودة

💡 **لأي باقة تناسبك، أحتاج أعرف:**
• عدد المستخدمين اللي تحتاجهم؟
• كم فرع عندك؟
• طبيعة نشاط شركتك؟

📞 فريق المبيعات جاهز لمساعدتك: +966555111222`;
    }
    
    if (msg.includes('نظام') || msg.includes('erp') || msg.includes('برنامج') || 
        msg.includes('سوفت وير') || msg.includes('system')) {
        
        return `🌟 **نظام رقم كلاود ERP السحابي**

هو حل متكامل لإدارة شركتك بشكل احترافي:

✅ **المميزات الأساسية:**
• محاسبة متكاملة مع الزكاة والضريبة
• إدارة مخزون ومستودعات ذكية
• نظام موارد بشرية ورواتب
• إدارة علاقات عملاء (CRM)
• تقارير وتحليلات فورية
• تكامل مع المنصات الحكومية

🚀 **فوائد للنظام:**
• توفير 50% من وقت المتابعة اليومية
• تقليل الأخطاء المحاسبية
• متابعة كل الفروع من مكان واحد
• تقارير فورية لاتخاذ القرارات

💼 **يناسب:**
• الشركات الصغيرة والمتوسطة
• المؤسسات التجارية والصناعية
• المستودعات ومراكز التوزيع
• شركات المقاولات والخدمات

📞 جرب النظام مجاناً: +966555111222`;
    }
    
    if (msg.includes('محاسبة') || msg.includes('محاسب') || msg.includes('حسابات') || 
        msg.includes('مالي') || msg.includes('accounting')) {
        
        return `🧮 **الحلول المحاسبية في رقم كلاود:**

📊 **النظام المحاسبي المتكامل:**
• الدفاتر المحاسبية المتكاملة
• تسجيل الفواتير والمصروفات
• الميزانيات والتقارير المالية
• التكامل مع الزكاة والضريبة
• كشوف الحسابات المصرفية

✅ **مميزات المحاسبة:**
• متوافق مع أنظمة الهيئة العامة للزكاة والضريبة
• تقارير مالية فورية وجاهزة
• نسخ احتياطي تلقائي للبيانات
• واجهة عربية سهلة الاستخدام

💡 **بتقدر تعمل:**
• متابعة حركة المبيعات والمشتريات
• تحليل التكاليف والأرباح
• إدارة التدفقات النقدية
• تقارير الأداء المالي

📞 استشارة محاسبية مجانية: +966555111222`;
    }
    
    if (msg.includes('مخزون') || msg.includes('مستودع') || msg.includes('بضاعة') || 
        msg.includes('inventory') || msg.includes('stock')) {
        
        return `📦 **نظام إدارة المخزون المتكامل:**

🔄 **إدارة المخزون الذكية:**
• تتبع البضاعة والمنتجات
• إدارة الفروع والمستودعات
• تنبيهات نقص المخزون الآلية
• تقارير حركة البضاعة
• جرد المخزون الآلي

🚀 **مميزات النظام:**
• تقارير ربحية المنتجات
• تحليل بطء وسرعة الحركة
• تكامل مع نظام المبيعات
• إدارة الموردين والمشتريات

💰 **وفّر على شركتك:**
• تقليل الهدر والفاقد
• تحسين التدفق النقدي
• زيادة كفاءة المستودعات

📞 للاستشارة: +966555111222`;
    }
    
    if (msg.includes('تجريب') || msg.includes('تجربة') || msg.includes('demo') || 
        msg.includes('جرب') || msg.includes('نسخة')) {
        
        return `🎯 **جرب نظام رقم كلاود مجاناً!**

نقدم لك نسخة تجريبية مجانية لمدة 7 أيام لتقييم النظام:

✅ **ما تحصل عليه في النسخة التجريبية:**
• الوصول الكامل لجميع الميزات
• دعم فني خلال فترة التجربة
• تدريب على استخدام النظام
• تقارير تجريبية لشركتك

📋 **لبدء التجربة:**
1. تواصل مع فريق المبيعات
2. حدد موعد للتدريب
3. ابدأ باستخدام النظام فوراً

📞 احجز نسختك التجريبية الآن: +966555111222
🌐 أو زور موقعنا: ragmcloud.sa

جرب وشوف الفرق في إدارة شركتك!`;
    }
    
    if (msg.includes('اتصل') || msg.includes('تواصل') || msg.includes('رقم') || 
        msg.includes('هاتف') || msg.includes('contact')) {
        
        return `📞 **تواصل مع فريق رقم كلاود:**

نحن هنا لمساعدتك في اختيار النظام المناسب:

**طرق التواصل:**
• الهاتف: +966555111222
• الواتساب: +966555111222  
• البريد: info@ragmcloud.sa
• الموقع: ragmcloud.sa

**أوقات العمل:**
من الأحد إلى الخميس
من 8 صباحاً إلى 6 مساءً

**مقرنا:**
الرياض - حي المغرزات - طريق الملك عبد الله

فريق المبيعات جاهز لاستقبال استفساراتك وتقديم الاستشارة المجانية!`;
    }
    
    return `أهلاً وسهلاً بك! 👋

أنت تتحدث مع مساعد رقم كلاود المتخصص في أنظمة ERP السحابية.

🎯 **كيف يمكنني مساعدتك؟**

1. **اختيار الباقة المناسبة** لشركتك من بين 4 باقات
2. **شرح الميزات** المحاسبية والإدارية  
3. **ترتيب نسخة تجريبية** مجانية
4. **توصيلك بفريق المبيعات** للاستشارة

💡 **لماذا تختار رقم كلاود؟**
• نظام سحابي 100% - لا تحتاج خوادم
• واجهة عربية سهلة الاستخدام
• دعم فني على مدار الساعة
• توفير وقت وجهد إدارة الشركة

📞 **اتصل الآن للاستشارة المجانية: +966555111222**
🌐 **أو زور موقعنا: ragmcloud.sa**

أخبرني عن طبيعة نشاط شركتك علشان أقدر أساعدك في اختيار النظام المناسب!`;
}

// AI Response - ALWAYS TRY DEEPSEEK FIRST
async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    console.log('🔄 Processing message for Ragmcloud with memory:', userMessage);
    
    if (deepseekAvailable) {
        try {
            console.log('🎯 Using DeepSeek with conversation memory...');
            
            const aiResponse = await callDeepSeekAI(userMessage, clientPhone);
            
            console.log('✅ DeepSeek Response successful');
            console.log('💬 AI Reply:', aiResponse);
            return aiResponse;
            
        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            console.log('🔄 Falling back to enhanced responses...');
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        }
    }
    
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
}

// Store messages per client with better reliability
function storeClientMessage(phone, message, isFromMe) {
    try {
        const messageData = {
            message: message,
            fromMe: isFromMe,
            timestamp: new Date().toISOString()
        };

        let clientMessages = [];
        const messageFile = `./memory/messages_${phone}.json`;
        
        if (!fs.existsSync('./memory')) {
            fs.mkdirSync('./memory', { recursive: true });
        }
        
        if (fs.existsSync(messageFile)) {
            try {
                const messagesData = fs.readFileSync(messageFile, 'utf8');
                clientMessages = JSON.parse(messagesData);
            } catch (error) {
                console.error('Error reading message file:', error);
                clientMessages = [];
            }
        }

        clientMessages.push(messageData);
        
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
        console.log(`💾 Stored message for ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing client message:', error);
    }
}

// Get client messages with error handling
function getClientMessages(phone) {
    try {
        const messageFile = `./memory/messages_${phone}.json`;
        
        if (fs.existsSync(messageFile)) {
            const messagesData = fs.readFileSync(messageFile, 'utf8');
            return JSON.parse(messagesData);
        }
    } catch (error) {
        console.error('Error getting client messages:', error);
    }
    
    return [];
}

// Process incoming messages with immediate auto-reply
async function processIncomingMessage(message, from) {
    try {
        console.log(`📩 Processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        storeClientMessage(clientPhone, message, false);
        autoDetectClientInterest(clientPhone, message);
        
        if (isBotStopped) {
            console.log('🤖 Bot is stopped - no auto-reply');
            return;
        }
        
        if (!shouldReplyToClient(clientPhone)) {
            console.log('⏸️ Client not in imported list - skipping auto-reply');
            return;
        }
        
        if (!shouldAutoReplyNow(clientPhone)) {
            console.log('⏰ Waiting for 3-second delay before next reply');
            return;
        }
        
        console.log('🤖 Generating AI response...');
        
        let aiResponse;
        try {
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error('❌ AI response error:', aiError.message);
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        await whatsappClient.sendMessage(from, aiResponse);
        storeClientMessage(clientPhone, aiResponse, true);
        updateReplyTimer(clientPhone);
        trackEmployeeActivity('ai_reply', { clientPhone: clientPhone });
        
        io.emit('message', {
            from: clientPhone,
            message: aiResponse,
            timestamp: new Date(),
            fromMe: true
        });
        
        console.log(`✅ Auto-reply sent to ${clientPhone}`);
        
    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
        
        try {
            const professionalMessage = "عذراً، يبدو أن هناك تأخير في النظام. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة على +966555111222";
            await whatsappClient.sendMessage(from, professionalMessage);
        } catch (sendError) {
            console.error('❌ Failed to send error message:', sendError);
        }
    }
}

// Phone number formatting
function formatPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.toString().replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '966' + cleaned.substring(1);
    } else if (cleaned.startsWith('+966')) {
        cleaned = cleaned.substring(1);
    } else if (cleaned.startsWith('966')) {
        // Already in correct format
    } else if (cleaned.length === 9) {
        cleaned = '966' + cleaned;
    }
    
    return cleaned;
}

// Enhanced Excel file processing
function processExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const clients = jsonData.map((row, index) => {
            const name = row['Name'] || row['name'] || row['الاسم'] || row['اسم'] || 
                         row['اسم العميل'] || row['Client Name'] || row['client_name'] || 
                         `عميل ${index + 1}`;
            
            const phone = formatPhoneNumber(
                row['Phone'] || row['phone'] || row['الهاتف'] || row['هاتف'] || 
                row['رقم الجوال'] || row['جوال'] || row['Phone Number'] || 
                row['phone_number'] || row['رقم الهاتف'] || row['mobile'] || 
                row['Mobile'] || row['الجوال']
            );
            
            return {
                id: index + 1,
                name: name,
                phone: phone,
                lastMessage: 'لم يتم المراسلة بعد',
                unread: 0,
                importedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                status: 'no-reply'
            };
        }).filter(client => {
            return client.phone && client.phone.length >= 10;
        });

        console.log('✅ Processed clients:', clients.length);
        return clients;
    } catch (error) {
        console.error('❌ Error processing Excel file:', error);
        throw error;
    }
}

// IMPROVED WhatsApp Client with better reconnection
function initializeWhatsApp() {
    console.log('🔄 Starting WhatsApp...');
    
    try {
        if (whatsappClient) {
            try {
                whatsappClient.destroy();
            } catch (e) {
                console.log('ℹ️ No previous client to clean up');
            }
        }

        whatsappClient = new Client({
            authStrategy: new LocalAuth({
                clientId: "ragmcloud-erp-v1",
                dataPath: "./sessions"
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        // QR Code Generation
        whatsappClient.on('qr', (qr) => {
            console.log('📱 QR CODE RECEIVED');
            qrcode.generate(qr, { small: true });
            
            QRCode.toDataURL(qr, { 
                width: 300,
                height: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            }, (err, url) => {
                if (err) {
                    console.error('❌ Error generating QR code for web:', err);
                    qrCodeUrl = 'data:image/svg+xml;base64,' + Buffer.from(`
                        <svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
                            <rect width="100%" height="100%" fill="white"/>
                            <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Arial" font-size="14" fill="red">
                                QR Error - Check Console
                            </text>
                        </svg>
                    `).toString('base64');
                } else {
                    qrCodeUrl = url;
                    console.log('✅ QR code generated successfully for web');
                }
                
                io.emit('qr', qrCodeUrl);
                io.emit('status', { 
                    connected: false, 
                    message: 'يرجى مسح QR Code للاتصال',
                    qrAvailable: true 
                });
            });
        });

        // Ready Event
        whatsappClient.on('ready', () => {
            console.log('✅ WhatsApp READY!');
            isConnected = true;
            qrCodeUrl = '';
            io.emit('status', { 
                connected: true, 
                message: 'واتساب متصل ✅',
                qrAvailable: false 
            });
            io.emit('qr', '');
        });

        // Message Event with Auto-Reply
        whatsappClient.on('message', async (message) => {
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log('📩 Received message from:', message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                storeClientMessage(clientPhone, message.body, false);
                
                io.emit('message', {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    clientName: `عميل ${clientPhone}`
                });

                if (!isBotStopped) {
                    processIncomingMessage(message.body, message.from).catch(error => {
                        console.error('❌ Error in processIncomingMessage:', error);
                    });
                }
                
            } catch (error) {
                console.error('❌ Error handling message:', error);
            }
        });

        // Authentication Failure
        whatsappClient.on('auth_failure', (msg) => {
            console.log('❌ WhatsApp auth failed:', msg);
            isConnected = false;
            io.emit('status', { 
                connected: false, 
                message: 'فشل المصادقة - جاري إعادة المحاولة...',
                qrAvailable: false 
            });
        });

        // Disconnected Event
        whatsappClient.on('disconnected', (reason) => {
            console.log('🔌 WhatsApp disconnected:', reason);
            isConnected = false;
            io.emit('status', { 
                connected: false, 
                message: 'جارٍ إعادة الاتصال...',
                qrAvailable: false 
            });
            
            setTimeout(() => {
                console.log('🔄 Attempting reconnection...');
                initializeWhatsApp();
            }, 5000);
        });

        whatsappClient.initialize().catch(error => {
            console.log('⚠️ WhatsApp init failed:', error.message);
            setTimeout(() => initializeWhatsApp(), 10000);
        });
        
    } catch (error) {
        console.log('❌ Error creating WhatsApp client:', error.message);
        setTimeout(() => initializeWhatsApp(), 10000);
    }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Routes

// Login endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }

        const user = await db.authenticateUser(username, password);
        
        if (user) {
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
                },
                message: 'تم تسجيل الدخول بنجاح'
            });
        } else {
            res.status(401).json({ 
                success: false, 
                error: 'اسم المستخدم أو كلمة المرور غير صحيحة' 
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Create user (admin only)
app.post('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بإنشاء مستخدمين' });
        }

        const { username, password, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }

        const newUser = await db.createUser(username, password, role || 'user');
        
        res.json({
            success: true,
            user: newUser,
            message: 'تم إنشاء المستخدم بنجاح'
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'فشل إنشاء المستخدم' });
    }
});

// Get all users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بمشاهدة المستخدمين' });
        }

        const users = await db.getAllUsers();
        res.json({ success: true, users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'فشل جلب بيانات المستخدمين' });
    }
});

// Get user conversations
app.get('/api/conversations/:clientPhone', authenticateToken, async (req, res) => {
    try {
        const { clientPhone } = req.params;
        const userId = req.user.role === 'admin' ? 'admin' : req.user.id;
        
        const messages = await db.getConversationHistory(userId, clientPhone);
        
        res.json({ 
            success: true, 
            messages: messages.map(msg => ({
                message: msg.message_text,
                fromMe: msg.is_from_me === 1,
                timestamp: msg.created_at,
                user: msg.user_id
            }))
        });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'فشل جبل المحادثة' });
    }
});

// Send individual message
app.post('/api/send-message', authenticateToken, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!isConnected) {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const formattedPhone = phone.includes('@c.us') ? phone : phone + '@c.us';
        
        await whatsappClient.sendMessage(formattedPhone, message);
        
        await db.saveMessage(req.user.id, phone, message, true);
        
        res.json({ 
            success: true, 
            message: 'تم إرسال الرسالة بنجاح'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة: ' + error.message });
    }
});

// Bulk send endpoint - FIXED
app.post('/api/send-bulk', authenticateToken, async (req, res) => {
    try {
        const { message, clients } = req.body;
        
        console.log('📤 Bulk send request received for', clients?.length, 'clients');

        if (!isConnected) {
            return res.status(400).json({ 
                success: false, 
                error: 'واتساب غير متصل' 
            });
        }

        if (!message || !clients || clients.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرسالة وقائمة العملاء مطلوبة' 
            });
        }

        let successCount = 0;
        let failCount = 0;
        const results = [];

        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            
            if (!client.phone || client.phone.length < 10) {
                failCount++;
                results.push({ phone: client.phone, success: false, error: 'رقم هاتف غير صالح' });
                continue;
            }

            try {
                const formattedPhone = client.phone.includes('@c.us') ? client.phone : client.phone + '@c.us';
                await whatsappClient.sendMessage(formattedPhone, message);
                
                successCount++;
                results.push({ phone: client.phone, success: true });
                
                await db.saveMessage(req.user.id, client.phone, message, true);
                
                console.log(`✅ Sent to ${client.phone} (${i + 1}/${clients.length})`);
                
            } catch (error) {
                failCount++;
                results.push({ phone: client.phone, success: false, error: error.message });
                console.error(`❌ Failed to send to ${client.phone}:`, error.message);
            }

            // Delay between messages (3 seconds)
            if (i < clients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        res.json({ 
            success: true, 
            message: `تم إرسال ${successCount} رسالة بنجاح وفشل ${failCount}`,
            results 
        });

    } catch (error) {
        console.error('❌ Error in bulk send:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل الإرسال الجماعي: ' + error.message 
        });
    }
});

// Upload Excel file
app.post('/api/upload-excel', authenticateToken, upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }

        console.log('📂 Processing uploaded file:', req.file.originalname);
        
        const clients = processExcelFile(req.file.path);

        if (clients.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'لم يتم العثور على بيانات صالحة في الملف' 
            });
        }

        fs.unlinkSync(req.file.path);

        res.json({ 
            success: true, 
            clients: clients, 
            count: clients.length,
            message: `تم معالجة ${clients.length} عميل بنجاح`
        });

    } catch (error) {
        console.error('❌ Error processing Excel:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            error: 'فشل معالجة ملف Excel: ' + error.message 
        });
    }
});

// Get QR status
app.get('/api/qr-status', (req, res) => {
    res.json({
        connected: isConnected,
        qrAvailable: !!qrCodeUrl && !isConnected,
        qrCode: qrCodeUrl
    });
});

// Get clients list
app.get('/api/clients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.role === 'admin' ? 'admin' : req.user.id;
        const clientPhones = await db.getAllClients(userId);
        
        const clients = clientPhones.map(phone => ({
            id: phone,
            name: `عميل ${phone}`,
            phone: phone,
            lastMessage: 'لا توجد رسائل',
            unread: 0,
            status: 'no-reply'
        }));

        res.json({ success: true, clients });
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// Default route - serve login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Dashboard route
app.get('/dashboard', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io for real-time communication
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('authenticate', (token) => {
        try {
            const user = jwt.verify(token, JWT_SECRET);
            activeUsers.set(socket.id, user);
            
            socket.emit('status', { 
                connected: isConnected, 
                message: isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...',
                qrAvailable: !!qrCodeUrl && !isConnected
            });

            if (qrCodeUrl && !isConnected) {
                socket.emit('qr', qrCodeUrl);
            }

            console.log(`✅ User ${user.username} authenticated`);
        } catch (error) {
            socket.emit('auth_error', 'Invalid token');
            socket.disconnect();
        }
    });

    socket.on('send_message', async (data) => {
        try {
            const user = activeUsers.get(socket.id);
            if (!user) {
                socket.emit('message_error', { error: 'غير مصرح' });
                return;
            }

            const { to, message } = data;
            
            if (!isConnected) {
                socket.emit('message_error', { error: 'واتساب غير متصل' });
                return;
            }

            const formattedPhone = to.includes('@c.us') ? to : to + '@c.us';
            await whatsappClient.sendMessage(formattedPhone, message);
            
            await db.saveMessage(user.id, to, message, true);
            
            socket.emit('message_sent', { to, message: 'تم الإرسال بنجاح' });
            
        } catch (error) {
            console.error(`Failed to send message:`, error);
            socket.emit('message_error', { error: error.message });
        }
    });

    socket.on('reconnect_whatsapp', () => {
        initializeWhatsApp();
    });

    socket.on('toggle_bot', (data) => {
        isBotStopped = data.stop;
        io.emit('bot_status', { stopped: isBotStopped });
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        console.log('Client disconnected:', socket.id);
    });
});

// Initialize
loadPerformanceData();
initializeWhatsApp();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('🏢 Company: رقم كلاود ERP');
    console.log('📞 Phone: +966555111222');
    console.log('🌐 Website: https://ragmcloud.sa');
    console.log('🔐 Authentication: ENABLED');
    console.log('👤 Admin: IT / @Admin4040');
    console.log('💾 Database: SQLite (database.sqlite)');
    console.log('📱 WhatsApp: Session persistence ENABLED');
    console.log('🤖 AI: DeepSeek Integration ENABLED');
});
