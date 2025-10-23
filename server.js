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

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.io
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Create required directories
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions'];
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

// Imported clients tracking
let importedClients = new Set();

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
    
    // CORRECT PACKAGES from website
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
    },

    // Services
    services: {
        accounting: "الحلول المحاسبية المتكاملة",
        inventory: "إدارة المخزون والمستودعات",
        hr: "إدارة الموارد البشرية والرواتب",
        crm: "إدارة علاقات العملاء",
        sales: "إدارة المبيعات والمشتريات", 
        reports: "التقارير والتحليلات الذكية",
        integration: "التكامل مع الأنظمة الحكومية"
    },

    // System Features
    features: [
        "سحابي 100% - لا حاجة لخوادم",
        "واجهة عربية سهلة الاستخدام", 
        "دعم فني على مدار الساعة",
        "تكامل مع الزكاة والضريبة",
        "تقارير ذكية وقابلة للتخصيص",
        "نسخ احتياطي تلقائي",
        "تطبيق جوال متكامل",
        "أمان عالي وحماية بيانات"
    ]
};

// AI System Prompt
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
        
        // Find the last message timestamp
        const lastMessage = messages[messages.length - 1];
        const lastMessageTime = new Date(lastMessage.timestamp);
        const currentTime = new Date();
        const hoursDiff = (currentTime - lastMessageTime) / (1000 * 60 * 60);
        
        // Return true if more than 5 hours passed
        return hoursDiff > 5;
    } catch (error) {
        console.error('Error checking greeting condition:', error);
        return true; // Default to greeting if error
    }
}

// FIXED: Check if we should auto-reply to client (REPLY TO ALL CLIENTS)
function shouldReplyToClient(phone) {
    // FIX: Remove the imported clients restriction - reply to ALL clients
    return true;
}

// Check if we should auto-reply to client (3-second delay)
function shouldAutoReplyNow(phone) {
    const lastReplyTime = clientReplyTimers.get(phone);
    if (!lastReplyTime) return true;
    
    const timeDiff = Date.now() - lastReplyTime;
    return timeDiff >= 3000; // 3 seconds minimum between replies
}

// Update client reply timer
function updateReplyTimer(phone) {
    clientReplyTimers.set(phone, Date.now());
}

// Auto-detect client interest based on message content
function autoDetectClientInterest(phone, message) {
    try {
        const msg = message.toLowerCase();
        
        // Keywords for different interest levels
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
        
        // Update client status in memory
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
        let clients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            clients = JSON.parse(clientsData);
        }

        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].status = status;
            clients[clientIndex].statusUpdatedAt = new Date().toISOString();
            fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
            
            // Emit status update to frontend
            io.emit('client_status_updated', {
                phone: phone,
                status: status,
                clients: clients
            });
            
            console.log(`🔄 Auto-updated client ${phone} status to: ${status}`);
        }
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
    
    // Check if we should auto-send report to manager (after 30 messages)
    checkAutoSendReport();
    
    // Save performance data
    savePerformanceData();
}

// Check if we should auto-send report to manager
function checkAutoSendReport() {
    const messageCount = employeePerformance.dailyStats.messagesSent;
    
    // Auto-send report after every 30 messages
    if (messageCount > 0 && messageCount % 30 === 0) {
        console.log(`📊 Auto-sending report to manager after ${messageCount} messages...`);
        
        // Send notification to frontend
        io.emit('auto_report_notification', {
            messageCount: messageCount,
            message: `تم إرسال ${messageCount} رسالة. جاري إرسال التقرير التلقائي إلى المدير...`
        });
        
        // Auto-send report
        setTimeout(() => {
            sendReportToManager().catch(error => {
                console.error('❌ Auto-report failed:', error);
            });
        }, 3000);
    }
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
            
            // Check if it's a new day
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

// Generate comprehensive employee performance report
function generateEmployeePerformanceReport() {
    const stats = employeePerformance.dailyStats;
    const totalInteractions = stats.messagesSent + stats.aiRepliesSent;
    const interestRate = stats.clientsContacted > 0 ? (stats.interestedClients / stats.clientsContacted * 100).toFixed(1) : 0;
    
    // Calculate performance score (0-100)
    let performanceScore = 0;
    performanceScore += Math.min(stats.messagesSent * 2, 30); // Max 30 points for messages
    performanceScore += Math.min(stats.clientsContacted * 5, 30); // Max 30 points for clients
    performanceScore += Math.min(stats.interestedClients * 10, 40); // Max 40 points for interested clients
    
    // Performance evaluation
    let performanceLevel = 'ضعيف';
    let improvementSuggestions = [];
    
    if (performanceScore >= 80) {
        performanceLevel = 'ممتاز';
    } else if (performanceScore >= 60) {
        performanceLevel = 'جيد جداً';
    } else if (performanceScore >= 40) {
        performanceLevel = 'جيد';
    } else if (performanceScore >= 20) {
        performanceLevel = 'مقبول';
    }
    
    // Generate improvement suggestions
    if (stats.messagesSent < 10) {
        improvementSuggestions.push('• زيادة عدد الرسائل المرسلة');
    }
    if (stats.clientsContacted < 5) {
        improvementSuggestions.push('• التواصل مع المزيد من العملاء');
    }
    if (stats.interestedClients < 2) {
        improvementSuggestions.push('• تحسين جودة المحادثات لجذب عملاء مهتمين');
    }
    if (stats.aiRepliesSent < stats.messagesSent * 0.3) {
        improvementSuggestions.push('• الاستفادة أكثر من الذكاء الاصطناعي في الردود');
    }
    
    if (improvementSuggestions.length === 0) {
        improvementSuggestions.push('• الاستمرار في الأداء المتميز');
    }
    
    const report = `
📊 **تقرير أداء الموظف - ${stats.date}**

🕒 **الإحصاءات العامة:**
• 📨 الرسائل المرسلة: ${stats.messagesSent}
• 👥 العملاء المتواصل معهم: ${stats.clientsContacted}
• 🤖 الردود الآلية: ${stats.aiRepliesSent}
• 📢 الحملات الجماعية: ${stats.bulkCampaigns}
• 💼 العملاء المهتمين: ${stats.interestedClients}
• 📈 معدل الاهتمام: ${interestRate}%

🎯 **التقييم:**
• النقاط: ${performanceScore}/100
• المستوى: ${performanceLevel}

📋 **ملخص الأداء:**
${performanceScore >= 80 ? '✅ أداء متميز في التواصل مع العملاء' : 
  performanceScore >= 60 ? '☑️ أداء جيد يحتاج لتحسين بسيط' :
  performanceScore >= 40 ? '📝 أداء مقبول يحتاج لتطوير' :
  '⚠️ يحتاج تحسين في الأداء'}

💡 **اقتراحات للتحسين:**
${improvementSuggestions.join('\n')}

⏰ **نشاط اليوم:**
• بدء العمل: ${new Date(stats.startTime).toLocaleTimeString('ar-SA')}
• آخر نشاط: ${new Date(stats.lastActivity).toLocaleTimeString('ar-SA')}
• المدة النشطة: ${calculateActiveHours(stats.startTime, stats.lastActivity)}

📞 **للمزيد من التفاصيل:** 
يمكن مراجعة التقارير التفصيلية في النظام
    `.trim();
    
    return report;
}

// Calculate active hours
function calculateActiveHours(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} ساعة ${minutes} دقيقة`;
}

// ENHANCED: Get conversation history for AI context
function getConversationHistoryForAI(phone, maxMessages = 10) {
    try {
        const messages = getClientMessages(phone);
        
        // Get recent messages (last 10 messages for context)
        const recentMessages = messages.slice(-maxMessages);
        
        // Format conversation history for AI
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

// ENHANCED: DeepSeek AI API Call with Conversation Memory
async function callDeepSeekAI(userMessage, clientPhone) {
    if (!deepseekAvailable || !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek not available');
    }

    try {
        console.log('🚀 Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        const conversationHistory = getConversationHistoryForAI(clientPhone);
        
        // Build messages array
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT
            }
        ];

        // Add conversation history
        if (conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

        // Add current user message with context
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
    
    // Check for personal/irrelevant questions - REJECT THEM
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
    
    // Greeting only at start or after 5 hours
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
    
    // Price/Packages questions
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
    
    // ERP System questions
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
    
    // Accounting questions
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
    
    // Inventory questions  
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
    
    // Trial/Demo requests
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
    
    // Contact requests
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
    
    // Default response - CONVINCING SALES APPROACH
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

// ENHANCED AI Response - ALWAYS TRY DEEPSEEK FIRST
async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    console.log('🔄 Processing message for Ragmcloud with memory:', userMessage);
    
    // ALWAYS try DeepSeek first if available
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
    
    // If DeepSeek not available, use enhanced fallback
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
}

// ENHANCED: Store messages per client with better reliability
function storeClientMessage(phone, message, isFromMe) {
    try {
        const messageData = {
            message: message,
            fromMe: isFromMe,
            timestamp: new Date().toISOString()
        };

        let clientMessages = [];
        const messageFile = `./memory/messages_${phone}.json`;
        
        // Ensure memory directory exists
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
        
        // Keep only last 50 messages to prevent file bloat
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
        console.log(`💾 Stored message for ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing client message:', error);
    }
}

// ENHANCED: Get client messages with error handling
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

// FIXED: Process incoming messages with immediate auto-reply
async function processIncomingMessage(message, from) {
    try {
        console.log(`📩 Processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        // Store the incoming message
        storeClientMessage(clientPhone, message, false);
        
        // Auto-detect client interest
        autoDetectClientInterest(clientPhone, message);
        
        // Check if bot is stopped
        if (isBotStopped) {
            console.log('🤖 Bot is stopped - no auto-reply');
            return;
        }
        
        // FIXED: Check if we should reply to this client (NOW REPLIES TO ALL CLIENTS)
        if (!shouldReplyToClient(clientPhone)) {
            console.log('⏸️ Client not in imported list - skipping auto-reply');
            return;
        }
        
        // Check if we should auto-reply now (3-second delay)
        if (!shouldAutoReplyNow(clientPhone)) {
            console.log('⏰ Waiting for 3-second delay before next reply');
            return;
        }
        
        console.log('🤖 Generating AI response...');
        
        let aiResponse;
        try {
            // Generate AI response with timeout
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error('❌ AI response error:', aiError.message);
            // Use enhanced fallback response instead of error message
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        // Send the response
        await whatsappClient.sendMessage(from, aiResponse);
        
        // Store the sent message
        storeClientMessage(clientPhone, aiResponse, true);
        
        // Update reply timer
        updateReplyTimer(clientPhone);
        
        // Track AI reply
        trackEmployeeActivity('ai_reply', { clientPhone: clientPhone });
        
        // Update client last message
        updateClientLastMessage(clientPhone, aiResponse);
        
        // Emit to frontend
        io.emit('message', {
            from: clientPhone,
            message: aiResponse,
            timestamp: new Date(),
            fromMe: true
        });
        
        console.log(`✅ Auto-reply sent to ${clientPhone}`);
        
    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
        
        // Send professional error message instead of technical one
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
            // Try multiple possible column names for name and phone
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
            // Filter only valid phone numbers
            return client.phone && client.phone.length >= 10;
        });

        console.log('✅ Processed clients:', clients.length);
        
        // Add to imported clients set for auto-reply filtering
        clients.forEach(client => {
            importedClients.add(client.phone);
        });

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
        // Clean up previous session if exists
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
            
            // Generate QR code for web interface
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    qrCodeUrl = url;
                    io.emit('qr', qrCodeUrl);
                    io.emit('status', { connected: false, message: 'يرجى مسح QR Code' });
                }
            });
        });

        // Ready Event
        whatsappClient.on('ready', () => {
            console.log('✅ WhatsApp READY!');
            isConnected = true;
            io.emit('status', { connected: true, message: 'واتساب متصل ✅' });
        });

        // FIXED: Message Event with IMMEDIATE Auto-Reply
        whatsappClient.on('message', async (message) => {
            // Ignore status broadcasts and messages from us
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log('📩 Received message from:', message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                // Store incoming message immediately
                const clientPhone = message.from.replace('@c.us', '');
                storeClientMessage(clientPhone, message.body, false);
                
                // Emit to frontend
                io.emit('message', {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false
                });

                // Update client last message
                updateClientLastMessage(clientPhone, message.body);

                // Process incoming message with auto-reply (non-blocking)
                processIncomingMessage(message.body, message.from).catch(error => {
                    console.error('❌ Error in processIncomingMessage:', error);
                });
                
            } catch (error) {
                console.error('❌ Error handling message:', error);
            }
        });

        // Authentication Failure
        whatsappClient.on('auth_failure', (msg) => {
            console.log('❌ WhatsApp auth failed:', msg);
            isConnected = false;
            io.emit('status', { connected: false, message: 'فشل المصادقة' });
        });

        // Disconnected Event
        whatsappClient.on('disconnected', (reason) => {
            console.log('🔌 WhatsApp disconnected:', reason);
            isConnected = false;
            io.emit('status', { connected: false, message: 'جارٍ إعادة الاتصال...' });
            
            // Auto-reconnect after 5 seconds
            setTimeout(() => {
                console.log('🔄 Attempting reconnection...');
                initializeWhatsApp();
            }, 5000);
        });

        // Start initialization
        whatsappClient.initialize().catch(error => {
            console.log('⚠️ WhatsApp init failed:', error.message);
            // Retry after 10 seconds
            setTimeout(() => initializeWhatsApp(), 10000);
        });
        
    } catch (error) {
        console.log('❌ Error creating WhatsApp client:', error.message);
        setTimeout(() => initializeWhatsApp(), 10000);
    }
}

// Update client last message
function updateClientLastMessage(phone, message) {
    try {
        let clients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            clients = JSON.parse(clientsData);
        }

        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
            clients[clientIndex].lastActivity = new Date().toISOString();
            fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
            io.emit('clients_updated', clients);
        }
    } catch (error) {
        console.error('Error updating client last message:', error);
    }
}

// Manual reconnection function
function manualReconnectWhatsApp() {
    console.log('🔄 Manual reconnection requested...');
    if (whatsappClient) {
        whatsappClient.destroy().then(() => {
            setTimeout(() => initializeWhatsApp(), 2000);
        });
    } else {
        initializeWhatsApp();
    }
}

// Send report to manager
async function sendReportToManager() {
    if (!isConnected) {
        throw new Error('واتساب غير متصل');
    }

    try {
        const report = generateEmployeePerformanceReport();
        const managerPhone = '966531304279@c.us';
        
        console.log('📤 Sending report to manager:', managerPhone);
        
        await whatsappClient.sendMessage(managerPhone, report);
        
        console.log('✅ Report sent to manager successfully');
        return true;
    } catch (error) {
        console.error('❌ Error sending report to manager:', error);
        throw error;
    }
}

// Export report to file
function exportReportToFile() {
    try {
        const report = generateEmployeePerformanceReport();
        const fileName = `employee_report_${employeePerformance.dailyStats.date}_${Date.now()}.txt`;
        const filePath = path.join(__dirname, 'reports', fileName);
        
        // Ensure reports directory exists
        if (!fs.existsSync(path.join(__dirname, 'reports'))) {
            fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
        }
        
        fs.writeFileSync(filePath, report, 'utf8');
        console.log('✅ Report exported to file successfully');
        
        return {
            success: true,
            fileName: fileName,
            filePath: filePath,
            report: report
        };
    } catch (error) {
        console.error('❌ Error exporting report:', error);
        throw error;
    }
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload Excel file
app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
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

        // Save clients to file
        fs.writeFileSync('./memory/clients.json', JSON.stringify(clients, null, 2));
        fs.unlinkSync(req.file.path); // Clean up uploaded file

        // Emit to all connected clients
        io.emit('clients_updated', clients);

        res.json({ 
            success: true, 
            clients: clients, 
            count: clients.length,
            message: `تم معالجة ${clients.length} عميل بنجاح`
        });

    } catch (error) {
        console.error('❌ Error processing Excel:', error);
        
        // Clean up uploaded file
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: 'فشل معالجة ملف Excel: ' + error.message 
        });
    }
});

// Get clients list
app.get('/api/clients', (req, res) => {
    try {
        if (fs.existsSync('./memory/clients.json')) {
            const clientsData = fs.readFileSync('./memory/clients.json', 'utf8');
            const clients = JSON.parse(clientsData);
            res.json({ success: true, clients: clients });
        } else {
            res.json({ success: true, clients: [] });
        }
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// Get client messages
app.get('/api/client-messages/:phone', (req, res) => {
    try {
        const phone = req.params.phone;
        const messages = getClientMessages(phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// Get employee performance data
app.get('/api/employee-performance', (req, res) => {
    try {
        const performanceData = {
            ...employeePerformance,
            clientInteractions: Array.from(employeePerformance.clientInteractions.entries()),
            report: generateEmployeePerformanceReport()
        };
        res.json({ success: true, performance: performanceData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle bot status
app.post('/api/toggle-bot', (req, res) => {
    try {
        const { stop } = req.body;
        isBotStopped = stop;
        
        console.log(`🤖 Bot ${isBotStopped ? 'stopped' : 'started'}`);
        
        // Emit bot status to all connected clients
        io.emit('bot_status', { stopped: isBotStopped });
        
        res.json({ 
            success: true, 
            stopped: isBotStopped,
            message: `تم ${isBotStopped ? 'إيقاف' : 'تشغيل'} البوت بنجاح`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send report to manager
app.post('/api/send-to-manager', async (req, res) => {
    try {
        console.log('🔄 Sending report to manager...');
        await sendReportToManager();
        res.json({ 
            success: true, 
            message: 'تم إرسال التقرير إلى المدير بنجاح'
        });
    } catch (error) {
        console.error('❌ Error sending report to manager:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل إرسال التقرير: ' + error.message 
        });
    }
});

// Export report
app.get('/api/export-report', (req, res) => {
    try {
        console.log('🔄 Exporting report...');
        const result = exportReportToFile();
        
        // Send the file for download
        res.download(result.filePath, result.fileName, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).json({ 
                    success: false, 
                    error: 'فشل تحميل التقرير' 
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Error exporting report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل تصدير التقرير: ' + error.message 
        });
    }
});

// Bulk send endpoint
app.post('/api/send-bulk', async (req, res) => {
    try {
        const { message, delay = 40, clients } = req.body;
        
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
        
        // Track bulk campaign
        trackEmployeeActivity('bulk_campaign', { 
            clientCount: clients.length,
            message: message.substring(0, 50) 
        });
        
        io.emit('bulk_progress', {
            type: 'start',
            total: clients.length,
            message: `بدأ الإرسال إلى ${clients.length} عميل`
        });

        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            
            if (!client.phone || client.phone.length < 10) {
                failCount++;
                continue;
            }

            const formattedPhone = formatPhoneNumber(client.phone);
            const phoneNumber = formattedPhone + '@c.us';
            
            try {
                // Wait between messages (except first one)
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                }
                
                await whatsappClient.sendMessage(phoneNumber, message);
                
                successCount++;
                
                client.lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
                client.lastSent = new Date().toISOString();
                
                // Track message sent
                trackEmployeeActivity('message_sent', { 
                    clientPhone: formattedPhone,
                    clientName: client.name,
                    message: message.substring(0, 30) 
                });
                
                io.emit('bulk_progress', {
                    success: true,
                    client: client.name,
                    clientPhone: client.phone,
                    message: message.substring(0, 30) + '...',
                    current: i + 1,
                    total: clients.length
                });

                storeClientMessage(client.phone, message, true);
                
                console.log(`✅ Sent to ${client.name}: ${client.phone} (${i + 1}/${clients.length})`);
                
            } catch (error) {
                failCount++;
                
                io.emit('bulk_progress', {
                    success: false,
                    client: client.name,
                    clientPhone: client.phone,
                    error: error.message,
                    current: i + 1,
                    total: clients.length
                });
                
                console.error(`❌ Failed to send to ${client.name}:`, error.message);
            }
        }

        res.json({ 
            success: true, 
            message: `تم إرسال ${successCount} رسالة بنجاح وفشل ${failCount}`
        });

        console.log(`🎉 Bulk send completed: ${successCount} successful, ${failCount} failed`);

    } catch (error) {
        console.error('❌ Error in bulk send:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل الإرسال الجماعي: ' + error.message 
        });
    }
});

// Send individual message
app.post('/api/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!isConnected) {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const phoneNumber = formattedPhone + '@c.us';
        
        await whatsappClient.sendMessage(phoneNumber, message);
        
        // Track individual message
        trackEmployeeActivity('message_sent', { 
            clientPhone: formattedPhone,
            message: message.substring(0, 30) 
        });
        
        storeClientMessage(phone, message, true);
        updateClientLastMessage(phone, message);
        
        res.json({ 
            success: true, 
            message: 'تم إرسال الرسالة بنجاح'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة: ' + error.message });
    }
});

// Reconnect endpoint
app.post('/api/reconnect-whatsapp', (req, res) => {
    try {
        manualReconnectWhatsApp();
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
    }
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...' 
    });

    // Send bot status
    socket.emit('bot_status', { stopped: isBotStopped });

    if (qrCodeUrl) {
        socket.emit('qr', qrCodeUrl);
    }

    // Handle bot toggle
    socket.on('toggle_bot', (data) => {
        isBotStopped = data.stop;
        console.log(`🤖 Bot ${isBotStopped ? 'stopped' : 'started'}`);
        
        // Emit bot status to all clients
        io.emit('bot_status', { stopped: isBotStopped });
    });

    // Handle client status update
    socket.on('update_client_status', (data) => {
        updateClientStatus(data.phone, data.status);
        socket.emit('client_status_updated', { success: true });
    });

    socket.on('send_message', async (data) => {
        try {
            const { to, message } = data;
            
            if (!isConnected) {
                socket.emit('message_error', { 
                    to: to, 
                    error: 'واتساب غير متصل' 
                });
                return;
            }

            if (!to || !message) {
                socket.emit('message_error', { 
                    to: to, 
                    error: 'رقم الهاتف والرسالة مطلوبان' 
                });
                return;
            }

            const formattedPhone = formatPhoneNumber(to);
            const phoneNumber = formattedPhone + '@c.us';
            
            await whatsappClient.sendMessage(phoneNumber, message);
            
            // Track individual message
            trackEmployeeActivity('message_sent', { 
                clientPhone: formattedPhone,
                message: message.substring(0, 30) 
            });
            
            storeClientMessage(to, message, true);
            updateClientLastMessage(to, message);
            
            socket.emit('message_sent', { 
                to: to,
                message: 'تم الإرسال بنجاح'
            });
            
        } catch (error) {
            console.error(`Failed to send message to ${data.to}:`, error);
            socket.emit('message_error', { 
                to: data.to, 
                error: error.message 
            });
        }
    });

    socket.on('reconnect_whatsapp', () => {
        manualReconnectWhatsApp();
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Load performance data on startup
loadPerformanceData();

// Initialize WhatsApp client
initializeWhatsApp();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('🏢 Company:', ragmcloudCompanyInfo.name);
    console.log('📞 Phone:', ragmcloudCompanyInfo.phone);
    console.log('🌐 Website:', ragmcloudCompanyInfo.website);
    console.log('🔑 DeepSeek Available:', deepseekAvailable);
    console.log('🤖 BOT STATUS: READY');
    console.log('⏰ AUTO-REPLY DELAY: 3 SECONDS');
    console.log('🎯 AI AUTO-STATUS DETECTION: ENABLED');
    console.log('📊 AUTO-REPORT AFTER 30 MESSAGES: ENABLED');
    console.log('💰 CORRECT PACKAGES: 1000, 1800, 2700, 3000 ريال');
    console.log('🔄 CRITICAL FIX: AUTO-REPLY NOW WORKS FOR ALL CLIENTS');
});