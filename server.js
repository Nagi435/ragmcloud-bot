// server.js
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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, dbHelper } = require('./database');

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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud-erp-bot-secret-key-2024';

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'الوصول مرفوض. يرجى تسجيل الدخول.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'رمز الدخول غير صالح.' });
        }
        req.user = user;
        next();
    });
};

// WhatsApp Client
let whatsappClient;
let isConnected = false;
let qrCodeUrl = '';
let isBotStopped = false;

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

// Enhanced Ragmcloud responses
function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
    const msg = userMessage.toLowerCase().trim();
    
    // Check for personal/irrelevant questions
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
    
    // Greeting responses
    if (msg.includes('السلام') || msg.includes('سلام') || msg.includes('اهلا') || 
        msg.includes('مرحبا') || msg.includes('اهلين') || msg.includes('مساء') || 
        msg.includes('صباح') || msg.includes('hello') || msg.includes('hi')) {
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
    
    // Default response
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

// ENHANCED AI Response
async function generateRagmcloudAIResponse(userMessage, clientPhone, userId) {
    console.log('🔄 Processing message for Ragmcloud with AI...');
    
    // ALWAYS try DeepSeek first if available
    if (deepseekAvailable) {
        try {
            console.log('🎯 Using DeepSeek API...');
            
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        {
                            role: "system",
                            content: AI_SYSTEM_PROMPT
                        },
                        {
                            role: "user", 
                            content: `العميل يقول: "${userMessage}"
                            
الرد المطلوب (بلهجة البائع المحترف والمقنع):`
                        }
                    ],
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
                console.log('✅ DeepSeek Response successful');
                return data.choices[0].message.content;
            } else {
                throw new Error('Invalid response from DeepSeek');
            }

        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            console.log('🔄 Falling back to enhanced responses...');
        }
    }
    
    // If DeepSeek not available, use enhanced fallback
    console.log('🤖 Using enhanced fallback response');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
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

// Process incoming messages with auto-reply
async function processIncomingMessage(message, from, userId) {
    try {
        console.log(`📩 Processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        // Save to database
        await dbHelper.saveConversation(userId, clientPhone, message, 'received');
        await dbHelper.saveOrUpdateClient(clientPhone, `عميل ${clientPhone}`, userId);
        
        // Check if bot is stopped
        if (isBotStopped) {
            console.log('🤖 Bot is stopped - no auto-reply');
            return;
        }
        
        console.log('🤖 Generating AI response...');
        
        let aiResponse;
        try {
            // Generate AI response with timeout
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone, userId),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error('❌ AI response error:', aiError.message);
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        // Send the response
        await whatsappClient.sendMessage(from, aiResponse);
        
        // Save sent message to database
        await dbHelper.saveConversation(userId, clientPhone, aiResponse, 'sent');
        await dbHelper.updateEmployeePerformance(userId, new Date().toISOString().split('T')[0], 'messages_sent');
        await dbHelper.updateEmployeePerformance(userId, new Date().toISOString().split('T')[0], 'ai_replies_sent');
        
        // Emit to frontend
        io.emit('message', {
            from: clientPhone,
            message: aiResponse,
            timestamp: new Date(),
            fromMe: true,
            userId: userId
        });
        
        console.log(`✅ Auto-reply sent to ${clientPhone}`);
        
    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
        
        // Send professional error message
        try {
            const professionalMessage = "عذراً، يبدو أن هناك تأخير في النظام. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة على +966555111222";
            await whatsappClient.sendMessage(from, professionalMessage);
        } catch (sendError) {
            console.error('❌ Failed to send error message:', sendError);
        }
    }
}

// Enhanced Excel file processing
function processExcelFile(filePath, userId) {
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
                name: name,
                phone: phone
            };
        }).filter(client => {
            return client.phone && client.phone.length >= 10;
        });

        console.log('✅ Processed clients:', clients.length);
        
        // Save clients to database
        clients.forEach(async (client) => {
            await dbHelper.saveOrUpdateClient(client.phone, client.name, userId);
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
                clientId: "ragmcloud-erp-v2",
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
                    qrCodeUrl = '';
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

        // Message Event
        whatsappClient.on('message', async (message) => {
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log('📩 Received message from:', message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                
                // For now, assign to admin user (userId: 1)
                // In production, you might want to assign based on round-robin or other logic
                const assignedUserId = 1;
                
                // Save received message
                await dbHelper.saveConversation(assignedUserId, clientPhone, message.body, 'received');
                await dbHelper.saveOrUpdateClient(clientPhone, `عميل ${clientPhone}`, assignedUserId);
                
                // Emit to frontend
                io.emit('message', {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: assignedUserId
                });

                // Process incoming message with auto-reply
                processIncomingMessage(message.body, message.from, assignedUserId).catch(error => {
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

        // Start initialization
        whatsappClient.initialize().catch(error => {
            console.log('⚠️ WhatsApp init failed:', error.message);
            setTimeout(() => initializeWhatsApp(), 10000);
        });
        
    } catch (error) {
        console.log('❌ Error creating WhatsApp client:', error.message);
        setTimeout(() => initializeWhatsApp(), 10000);
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

// Generate employee performance report
function generateEmployeePerformanceReport(performanceData, username) {
    const today = new Date().toISOString().split('T')[0];
    
    const report = `
📊 **تقرير أداء الموظف - ${today}**

👤 **الموظف:** ${username}

🕒 **الإحصاءات العامة:**
• 📨 الرسائل المرسلة: ${performanceData.messages_sent || 0}
• 👥 العملاء المتواصل معهم: ${performanceData.clients_contacted || 0}
• 🤖 الردود الآلية: ${performanceData.ai_replies_sent || 0}
• 📢 الحملات الجماعية: ${performanceData.bulk_campaigns || 0}
• 💼 العملاء المهتمين: ${performanceData.interested_clients || 0}

⏰ **نشاط اليوم:**
• بدء العمل: ${performanceData.start_time ? new Date(performanceData.start_time).toLocaleTimeString('ar-SA') : 'غير محدد'}
• آخر نشاط: ${performanceData.last_activity ? new Date(performanceData.last_activity).toLocaleTimeString('ar-SA') : 'غير محدد'}

📞 **للمزيد من التفاصيل:** 
يمكن مراجعة التقارير التفصيلية في النظام
    `.trim();
    
    return report;
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes

// Login route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }

        const user = await dbHelper.getUserByUsername(username);
        
        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        // Update last login
        await dbHelper.updateUserLastLogin(user.id);

        // Generate token
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            },
            message: 'تم تسجيل الدخول بنجاح'
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Get current user
app.get('/api/user', authenticateToken, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// Get WhatsApp status
app.get('/api/whatsapp-status', authenticateToken, (req, res) => {
    res.json({
        connected: isConnected,
        qrCode: qrCodeUrl,
        message: isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...'
    });
});

// Get conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const { clientPhone } = req.query;
        let conversations;
        
        if (req.user.role === 'admin') {
            // Admin can see all conversations
            if (clientPhone) {
                conversations = await dbHelper.getConversationsByUser(null, clientPhone);
            } else {
                // Get all conversations grouped by client
                conversations = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT c.*, u.username 
                        FROM conversations c 
                        LEFT JOIN users u ON c.user_id = u.id 
                        WHERE c.id IN (
                            SELECT MAX(id) FROM conversations 
                            GROUP BY client_phone 
                        )
                        ORDER BY c.timestamp DESC
                    `, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
            }
        } else {
            // Regular users can only see their conversations
            conversations = await dbHelper.getConversationsByUser(req.user.id, clientPhone);
        }
        
        res.json({ conversations });
    } catch (error) {
        console.error('Error getting conversations:', error);
        res.status(500).json({ error: 'خطأ في جلب المحادثات' });
    }
});

// Get clients
app.get('/api/clients', authenticateToken, async (req, res) => {
    try {
        let clients;
        
        if (req.user.role === 'admin') {
            clients = await dbHelper.getAllClients();
        } else {
            clients = await dbHelper.getClientsByUser(req.user.id);
        }
        
        res.json({ clients });
    } catch (error) {
        console.error('Error getting clients:', error);
        res.status(500).json({ error: 'خطأ في جلب العملاء' });
    }
});

// Send message
app.post('/api/send-message', authenticateToken, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        if (!isConnected) {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        const formattedPhone = formatPhoneNumber(phone) + '@c.us';
        
        // Send message
        await whatsappClient.sendMessage(formattedPhone, message);
        
        // Save to database
        await dbHelper.saveConversation(req.user.id, phone, message, 'sent');
        await dbHelper.saveOrUpdateClient(phone, `عميل ${phone}`, req.user.id);
        await dbHelper.updateEmployeePerformance(req.user.id, new Date().toISOString().split('T')[0], 'messages_sent');
        
        res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
        
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'خطأ في إرسال الرسالة' });
    }
});

// Bulk send messages
app.post('/api/bulk-send', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'يرجى رفع ملف Excel' });
        }

        if (!isConnected) {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'الرسالة مطلوبة' });
        }

        // Process Excel file
        const clients = processExcelFile(req.file.path, req.user.id);
        
        let sentCount = 0;
        let failedCount = 0;
        const results = [];

        // Send messages with rate limiting
        for (const client of clients) {
            try {
                const formattedPhone = formatPhoneNumber(client.phone) + '@c.us';
                
                await whatsappClient.sendMessage(formattedPhone, message);
                
                // Save to database
                await dbHelper.saveConversation(req.user.id, client.phone, message, 'sent');
                await dbHelper.saveOrUpdateClient(client.phone, client.name, req.user.id);
                
                sentCount++;
                results.push({ phone: client.phone, status: 'success' });
                
                // Rate limiting: wait 2 seconds between messages
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`Failed to send to ${client.phone}:`, error.message);
                failedCount++;
                results.push({ phone: client.phone, status: 'failed', error: error.message });
            }
        }

        // Update performance
        await dbHelper.updateEmployeePerformance(req.user.id, new Date().toISOString().split('T')[0], 'bulk_campaigns');
        await dbHelper.updateEmployeePerformance(req.user.id, new Date().toISOString().split('T')[0], 'clients_contacted', sentCount);

        // Clean up file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `تم إرسال ${sentCount} رسالة بنجاح, فشل ${failedCount}`,
            results: results
        });

    } catch (error) {
        console.error('Error in bulk send:', error);
        res.status(500).json({ error: 'خطأ في الإرسال الجماعي' });
    }
});

// Get performance report
app.get('/api/performance', authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        let performanceData;
        
        if (req.user.role === 'admin') {
            performanceData = await dbHelper.getAllPerformance(targetDate);
        } else {
            performanceData = await dbHelper.getPerformanceByUser(req.user.id, targetDate);
        }
        
        res.json({ performance: performanceData || {} });
    } catch (error) {
        console.error('Error getting performance:', error);
        res.status(500).json({ error: 'خطأ في جلب تقرير الأداء' });
    }
});

// User management (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح بالوصول' });
        }
        
        const users = await dbHelper.getAllUsers();
        res.json({ users });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
    }
});

app.post('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح بالوصول' });
        }
        
        const { username, password, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }

        const result = await dbHelper.createUser(username, password, role);
        res.json({ success: true, message: 'تم إنشاء المستخدم بنجاح', userId: result.id });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
    }
});

// Bot control
app.post('/api/bot/stop', authenticateToken, (req, res) => {
    isBotStopped = true;
    res.json({ success: true, message: 'تم إيقاف الرد الآلي' });
});

app.post('/api/bot/start', authenticateToken, (req, res) => {
    isBotStopped = false;
    res.json({ success: true, message: 'تم تفعيل الرد الآلي' });
});

app.get('/api/bot/status', authenticateToken, (req, res) => {
    res.json({ stopped: isBotStopped });
});

// Reconnect WhatsApp
app.post('/api/whatsapp/reconnect', authenticateToken, (req, res) => {
    manualReconnectWhatsApp();
    res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
});

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve main app
app.get('/', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 WhatsApp ERP Bot Started`);
    console.log(`🔗 Access the system at: http://localhost:${PORT}`);
    
    // Initialize WhatsApp
    setTimeout(() => initializeWhatsApp(), 2000);
});
