const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const xlsx = require('xlsx');
const fs = require('fs');
const crypto = require('crypto');

// ==========================================
// إعدادات التطبيق والترخيص
// ==========================================
const EXPIRY_DATE = "2099-12-31"; 
const DEV_RESET_CODE = "DEV-2024-RESET"; 
const DEFAULT_PORT = 3000;

// تهيئة التطبيق
const app = express();

// Middleware (البرمجيات الوسيطة)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// التحقق من صلاحية النسخة (License Check)
app.use((req, res, next) => {
    const today = new Date();
    const expiry = new Date(EXPIRY_DATE);
    if (today > expiry) {
        return res.status(402).send(`
            <div style="font-family:sans-serif;text-align:center;padding:50px;direction:rtl">
                <h1>انتهت صلاحية النسخة التجريبية</h1>
                <p>يرجى التواصل مع المطور لتفعيل النسخة الكاملة.</p>
                <p>Code: EXP-OVER</p>
            </div>
        `);
    }
    next();
});

// ==========================================
// إدارة الملفات والمجلدات
// ==========================================
const folders = [
    'uploads', 
    'uploads/excel', 
    'uploads/lessons', 
    'public'
];

folders.forEach(folder => {
    const dirPath = path.join(__dirname, folder);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
});

// إعدادات Multer لرفع الملفات العامة (للدردشة)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname)
});
const upload = multer({ storage });

// إعدادات Multer لملفات Excel
const excelStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/excel')),
    filename: (req, file, cb) => cb(null, Date.now() + '.xlsx')
});
const uploadExcel = multer({ storage: excelStorage });

// إعدادات Multer لملفات الدروس
const lessonStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/lessons')),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const uploadLesson = multer({ storage: lessonStorage });

// ==========================================
// قاعدة البيانات (SQLite)
// ==========================================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('DB Error:', err.message);
    } else {
        console.log('Connected to SQLite Database.');
    }
});

// إنشاء الجداول (Schema Initialization)
db.serialize(() => {
    // 1. جدول المستخدمين
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        type TEXT CHECK(type IN ('admin','teacher','student')) NOT NULL,
        phone TEXT,
        avatar TEXT,
        level_id INTEGER,
        group_id INTEGER,
        registration_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        login_count INTEGER DEFAULT 0,
        last_login DATETIME
    )`);

    // تحديث الأعمدة المفقودة في حال وجود قاعدة بيانات قديمة
    db.all("PRAGMA table_info(users)", (err, rows) => {
        if (!rows.find(r => r.name === 'email')) db.run("ALTER TABLE users ADD COLUMN email TEXT");
        if (!rows.find(r => r.name === 'login_count')) db.run("ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0");
        if (!rows.find(r => r.name === 'last_login')) db.run("ALTER TABLE users ADD COLUMN last_login DATETIME");
    });

    // 2. جدول استعادة كلمة المرور
    db.run(`CREATE TABLE IF NOT EXISTS password_resets (
        token TEXT PRIMARY KEY,
        user_id INTEGER,
        expires_at DATETIME
    )`);

    // 3. الهيكل التعليمي (مواد، مستويات، أفواج)
    db.run(`CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        level_id INTEGER,
        FOREIGN KEY(level_id) REFERENCES levels(id)
    )`);

    // 4. جداول العلاقات والإسناد
    db.run(`CREATE TABLE IF NOT EXISTS teacher_subjects (
        teacher_id INTEGER,
        subject_id INTEGER,
        PRIMARY KEY (teacher_id, subject_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teacher_groups (
        teacher_id INTEGER,
        group_id INTEGER,
        PRIMARY KEY (teacher_id, group_id)
    )`);

    // جدول التدريس الفردي (مهم جداً للدروس الخصوصية أو الاستدراك)
    db.run(`CREATE TABLE IF NOT EXISTS teacher_teaching_students (
        teacher_id INTEGER,
        student_id INTEGER,
        PRIMARY KEY (teacher_id, student_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS student_teacher_links (
        student_id INTEGER,
        teacher_id INTEGER,
        PRIMARY KEY (student_id, teacher_id)
    )`);
    
    // 5. نظام الدردشة
    db.run(`CREATE TABLE IF NOT EXISTS chat_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        allow_private_chat BOOLEAN DEFAULT 0,
        only_admins_can_send BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.all("PRAGMA table_info(chat_groups)", (err, rows) => {
        if (!rows.find(r => r.name === 'only_admins_can_send')) db.run("ALTER TABLE chat_groups ADD COLUMN only_admins_can_send BOOLEAN DEFAULT 0");
    });

    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        user_id INTEGER,
        is_admin BOOLEAN DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
    )`);
    
    db.all("PRAGMA table_info(group_members)", (err, rows) => {
        if (!rows.find(r => r.name === 'is_admin')) db.run("ALTER TABLE group_members ADD COLUMN is_admin BOOLEAN DEFAULT 0");
    });

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        group_id INTEGER,
        subject_id INTEGER,
        message_text TEXT,
        message_type TEXT DEFAULT 'text',
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME
    )`);

    db.all("PRAGMA table_info(messages)", (err, rows) => {
        if (!rows.find(r => r.name === 'group_id')) db.run("ALTER TABLE messages ADD COLUMN group_id INTEGER");
    });

    // 6. نظام الدروس والمحتوى
    db.run(`CREATE TABLE IF NOT EXISTS lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER,
        subject_id INTEGER,
        title TEXT,
        description TEXT,
        file_path TEXT,
        target_all BOOLEAN DEFAULT 0,
        target_levels TEXT,
        target_groups TEXT,
        target_students TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.all("PRAGMA table_info(lessons)", (err, rows) => {
        if (!rows.find(r => r.name === 'target_all')) db.run("ALTER TABLE lessons ADD COLUMN target_all BOOLEAN DEFAULT 0");
    });

    // 7. نظام الإشعارات
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        message TEXT,
        link TEXT,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // إنشاء حساب المدير الافتراضي
    db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO users (name, username, password, email, type) VALUES (?, ?, ?, ?, ?)", 
                ['السيد المدير', 'admin', hash, 'admin@school.com', 'admin']);
            console.log("Admin account created.");
        } else {
            // ضمان تحديث الاسم للعرض الصحيح
            db.run("UPDATE users SET name = 'السيد المدير' WHERE username = 'admin'");
        }
    });
});

// ==========================================
// API Endpoints - Routes
// ==========================================

// --- تسجيل الدخول (Login) ---
app.post('/api/login', (req, res) => {
    const { username, password, userType } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'المستخدم غير موجود' });

        // التحقق من نوع المستخدم (أستاذ/طالبة)
        if (userType && user.type !== 'admin' && user.type !== userType) {
            return res.status(400).json({ error: 'يرجى اختيار نوع الحساب الصحيح (أستاذ/طالبة) من الشاشة الرئيسية' });
        }

        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });

        // تحديث إحصائيات الدخول
        db.run("UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);

        // جلب بيانات إضافية حسب نوع المستخدم
        if (user.type === 'teacher') {
            db.all("SELECT s.name FROM subjects s JOIN teacher_subjects ts ON ts.subject_id = s.id WHERE ts.teacher_id = ?", [user.id], (err, rows) => {
                const subjects = rows ? rows.map(r => r.name).join(', ') : '';
                res.json({ success: true, user: { ...user, subjects } });
            });
        } else if (user.type === 'student') {
             db.get(`SELECT l.name as l_name, g.name as g_name FROM levels l LEFT JOIN groups g ON g.level_id = l.id WHERE l.id = ? AND (g.id = ? OR ? IS NULL)`, 
             [user.level_id, user.group_id, user.group_id], (err, row) => {
                 res.json({ success: true, user: { ...user, level_name: row?.l_name, group_name: row?.g_name } });
             });
        } else {
            res.json({ success: true, user });
        }
    });
});

// --- إدارة حساب المسؤول ---
app.post('/api/admin/change-credentials', (req, res) => {
    const { id, oldPassword, newPassword, newEmail } = req.body;
    db.get("SELECT * FROM users WHERE id = ? AND type = 'admin'", [id], (err, user) => {
        if (!user) return res.status(404).json({error: 'المستخدم غير موجود'});
        
        const valid = bcrypt.compareSync(oldPassword, user.password);
        if (!valid) return res.status(400).json({error: 'كلمة المرور القديمة غير صحيحة'});
        
        let sql = "UPDATE users SET email = ?";
        let params = [newEmail];
        
        if (newPassword) {
            sql += ", password = ?";
            params.push(bcrypt.hashSync(newPassword, 10));
        }
        
        sql += " WHERE id = ?";
        params.push(id);
        
        db.run(sql, params, (err) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({success: true});
        });
    });
});

// --- استعادة كلمة المرور ---
app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get("SELECT * FROM users WHERE email = ? AND type = 'admin'", [email], (err, user) => {
        if (!user) return res.status(404).json({error: 'البريد غير مسجل'});
        
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000; // ساعة واحدة
        
        db.run("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)", [token, user.id, expires], (err) => {
            if(err) return res.status(500).json({error: err.message});
            const resetLink = `${req.protocol}://${req.get('host')}/admin?reset=${token}`;
            res.json({ success: true, message: 'تم إنشاء رابط الاستعادة.', link: resetLink });
        });
    });
});

app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    db.get("SELECT * FROM password_resets WHERE token = ?", [token], (err, reset) => {
        if (!reset || Date.now() > reset.expires_at) return res.status(400).json({error: 'رابط غير صالح أو منتهي'});
        
        const hash = bcrypt.hashSync(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hash, reset.user_id], (err) => {
            db.run("DELETE FROM password_resets WHERE token = ?", [token]);
            res.json({success: true});
        });
    });
});

// ==========================================
// إدارة المستخدمين (Teachers & Students)
// ==========================================

// 1. الأساتذة
app.get('/api/teachers/all', (req, res) => {
    db.all("SELECT * FROM users WHERE type = 'teacher' ORDER BY name", [], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/teachers', (req, res) => {
    const { name, username, phone } = req.body;
    const hash = bcrypt.hashSync(phone || '123456', 10);
    db.run("INSERT INTO users (name, username, password, type, phone) VALUES (?, ?, ?, 'teacher', ?)", 
        [name, username, hash, phone], function(err) {
            if (err) return res.status(400).json({ error: 'خطأ: قد يكون الاسم مكرراً' });
            res.json({ id: this.lastID });
    });
});

// استيراد الأساتذة من Excel
app.post('/api/teachers/import', uploadExcel.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);
        let imported = 0;

        await new Promise((resolve) => {
            db.serialize(() => {
                const stmt = db.prepare("INSERT INTO users (name, username, password, type, phone) VALUES (?, ?, ?, 'teacher', ?)");
                let pending = rows.length;
                if (pending === 0) resolve();

                rows.forEach(row => {
                    const k = Object.keys(row).reduce((acc,k)=>{acc[k.toLowerCase().trim()]=row[k];return acc},{});
                    if (k['name']) {
                        // توليد البيانات تلقائياً إذا كانت فارغة
                        const user = k['username'] || `t_${Date.now()}_${Math.floor(Math.random()*100)}`;
                        const phone = String(k['phone'] || Math.floor(100000+Math.random()*900000));
                        const pass = bcrypt.hashSync(phone, 10);
                        
                        stmt.run(k['name'], String(user), pass, String(phone), (err) => {
                            if (!err) imported++;
                            pending--;
                            if (pending === 0) resolve();
                        });
                    } else {
                        pending--;
                        if (pending === 0) resolve();
                    }
                });
                stmt.finalize();
            });
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ imported, success: true });
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

// تحديث مستخدم عام
app.put('/api/users/:id', (req, res) => {
    const { name, username, password, phone, level_id, group_id } = req.body;
    
    // جلب بيانات المستخدم أولاً للتحقق من النوع وتطبيق منطق تغيير كلمة المرور للأستاذ
    db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'المستخدم غير موجود' });

        let sql = "UPDATE users SET name = ?, username = ?";
        const params = [name, username];
        
        let passToHash = password;
        // إذا كان المستخدم أستاذاً وتم تغيير رقم الهاتف ولم يتم تعيين كلمة مرور جديدة، اجعل كلمة المرور هي رقم الهاتف الجديد
        if (user.type === 'teacher' && phone && phone !== user.phone && !password) {
            passToHash = phone;
        }

        if (passToHash) { 
            sql += ", password = ?"; 
            params.push(bcrypt.hashSync(passToHash, 10)); 
        }
        
        if (phone !== undefined) { sql += ", phone = ?"; params.push(phone); }
        if (level_id !== undefined) { sql += ", level_id = ?"; params.push(level_id); }
        if (group_id !== undefined) { sql += ", group_id = ?"; params.push(group_id); }
        
        sql += " WHERE id = ?"; params.push(req.params.id);
        
        db.run(sql, params, function(err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// 2. الطلاب
app.get('/api/students/all', (req, res) => {
    db.all(`SELECT u.*, l.name as level_name, g.name as group_name FROM users u LEFT JOIN levels l ON u.level_id = l.id LEFT JOIN groups g ON u.group_id = g.id WHERE u.type = 'student' ORDER BY u.name`, [], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/students', (req, res) => {
    const { name, username, level_id, group_id } = req.body;
    const regNum = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = bcrypt.hashSync(regNum, 10);
    
    db.run(`INSERT INTO users (name, username, password, type, level_id, group_id, registration_number) VALUES (?, ?, ?, 'student', ?, ?, ?)`, 
        [name, username, hash, level_id || null, group_id || null, regNum], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ id: this.lastID, registration_number: regNum });
    });
});

// استيراد الطلاب من Excel
app.post('/api/students/import', uploadExcel.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        const rows = xlsx.utils.sheet_to_json(xlsx.readFile(req.file.path).Sheets[xlsx.readFile(req.file.path).SheetNames[0]]);
        const levels = await new Promise(r => db.all("SELECT * FROM levels", (e,d)=>r(d||[])));
        const groups = await new Promise(r => db.all("SELECT * FROM groups", (e,d)=>r(d||[])));
        let imported = 0;
        
        await new Promise((resolve) => {
            db.serialize(() => {
                const stmt = db.prepare("INSERT INTO users (name, username, password, type, level_id, group_id, registration_number) VALUES (?, ?, ?, 'student', ?, ?, ?)");
                let pending = rows.length;
                if (pending === 0) resolve();
                
                rows.forEach(row => {
                    const k = Object.keys(row).reduce((acc,key)=>{acc[key.toLowerCase().trim()]=row[key];return acc},{});
                    if (k['name']) {
                        let lid = null, gid = null;
                        
                        // تحديد المستوى والفوج
                        if (k['level']) { 
                            const l = levels.find(x => x.name.trim().toLowerCase() == String(k['level']).trim().toLowerCase()); 
                            if (l) lid = l.id; 
                        }
                        
                        if (k['group']) { 
                            const gMatches = groups.filter(g => g.name.trim().toLowerCase() == String(k['group']).trim().toLowerCase()); 
                            if (gMatches.length) { 
                                if (lid) { 
                                    const g = gMatches.find(x => x.level_id == lid); 
                                    if (g) gid = g.id; 
                                } else { 
                                    gid = gMatches[0].id; 
                                    lid = gMatches[0].level_id; 
                                } 
                            }
                        }
                        
                        // توليد البيانات تلقائياً
                        const regNum = Math.floor(100000 + Math.random() * 900000).toString();
                        // إذا لم يوجد اسم مستخدم، يتم توليده
                        const username = k['username'] || `s_${regNum}`; 
                        const password = bcrypt.hashSync(regNum, 10);

                        stmt.run(k['name'], username, password, lid, gid, regNum, (err) => {
                            if (!err) imported++;
                            pending--;
                            if (pending === 0) resolve();
                        });
                    } else {
                        pending--;
                        if (pending === 0) resolve();
                    }
                });
                stmt.finalize();
            });
        });
        
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ imported, success: true });
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// الهيكل التعليمي (مستويات - أفواج - مواد)
// ==========================================

// المستويات (Levels)
app.get('/api/levels', (req, res) => db.all("SELECT * FROM levels", (e, r) => res.json(r || [])));
app.post('/api/levels', (req, res) => db.run("INSERT INTO levels (name) VALUES (?)", [req.body.name], function(e){ if(e)return res.status(400).json({error:e.message}); res.json({id:this.lastID}); }));
app.put('/api/levels/:id', (req, res) => db.run("UPDATE levels SET name = ? WHERE id = ?", [req.body.name, req.params.id], (e)=>res.json({success:true})));
app.delete('/api/levels/:id', (req, res) => db.run("DELETE FROM levels WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));

// الأفواج (Groups)
app.get('/api/groups', (req, res) => db.all("SELECT * FROM groups", (e, r) => res.json(r || [])));
app.post('/api/groups', (req, res) => db.run("INSERT INTO groups (name, level_id) VALUES (?, ?)", [req.body.name, req.body.level_id], function(e){ if(e)return res.status(400).json({error:e.message}); res.json({id:this.lastID}); }));
app.put('/api/groups/:id', (req, res) => db.run("UPDATE groups SET name = ?, level_id = ? WHERE id = ?", [req.body.name, req.body.level_id, req.params.id], (e)=>res.json({success:true})));
app.delete('/api/groups/:id', (req, res) => db.run("DELETE FROM groups WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));

// المواد (Subjects)
app.get('/api/subjects', (req, res) => db.all("SELECT * FROM subjects", (e, r) => res.json(r || [])));
app.post('/api/subjects', (req, res) => db.run("INSERT INTO subjects (name, description) VALUES (?, ?)", [req.body.name, req.body.description], function(e){ res.json({id:this.lastID}); }));
app.put('/api/subjects/:id', (req, res) => db.run("UPDATE subjects SET name = ?, description = ? WHERE id = ?", [req.body.name, req.body.description, req.params.id], (e)=>res.json({success:true})));
app.delete('/api/subjects/:id', (req, res) => db.run("DELETE FROM subjects WHERE id = ?", [req.params.id], (e)=>res.json({success:true})));

// ==========================================
// التعيينات والإسناد (Assignments)
// ==========================================

// 1. إسناد المواد للأساتذة
app.get('/api/teacher-subjects', (req, res) => db.all(`SELECT ts.*, u.name as teacher_name, s.name as subject_name FROM teacher_subjects ts JOIN users u ON u.id=ts.teacher_id JOIN subjects s ON s.id=ts.subject_id`, [], (e,r)=>res.json(r || [])));

app.post('/api/teacher-subjects/bulk', (req, res) => {
    const { teacher_id, subject_ids } = req.body;
    db.serialize(() => {
        db.run("DELETE FROM teacher_subjects WHERE teacher_id = ?", [teacher_id]);
        const stmt = db.prepare("INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)");
        subject_ids.forEach(sid => stmt.run(teacher_id, sid));
        stmt.finalize();
        res.json({success: true});
    });
});
app.delete('/api/teacher-subjects/:tid/:sid', (req, res) => db.run("DELETE FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?", [req.params.tid, req.params.sid], (e)=>res.json({success:true})));

// 2. إسناد الأفواج للأساتذة
app.get('/api/teacher-groups', (req, res) => db.all(`SELECT tg.*, u.name as teacher_name, g.name as group_name, l.name as level_name FROM teacher_groups tg JOIN users u ON u.id=tg.teacher_id JOIN groups g ON g.id=tg.group_id JOIN levels l ON g.level_id=l.id`, [], (e,r)=>res.json(r || [])));

app.post('/api/teacher-groups/bulk', (req, res) => {
    const { teacher_id, group_ids } = req.body;
    db.serialize(() => {
        db.run("DELETE FROM teacher_groups WHERE teacher_id = ?", [teacher_id]);
        const stmt = db.prepare("INSERT INTO teacher_groups (teacher_id, group_id) VALUES (?, ?)");
        group_ids.forEach(gid => stmt.run(teacher_id, gid));
        stmt.finalize();
        res.json({success: true});
    });
});
app.delete('/api/teacher-groups/:tid/:gid', (req, res) => db.run("DELETE FROM teacher_groups WHERE teacher_id = ? AND group_id = ?", [req.params.tid, req.params.gid], (e)=>res.json({success:true})));

// 3. إسناد الطلاب بشكل فردي للأساتذة (Individual Students)
app.get('/api/teacher-teaching-students', (req, res) => db.all(`SELECT tts.*, s.name as student_name, s.level_id, s.group_id, l.name as level_name, g.name as group_name FROM teacher_teaching_students tts JOIN users s ON s.id=tts.student_id LEFT JOIN levels l ON s.level_id = l.id LEFT JOIN groups g ON s.group_id = g.id`, [], (e,r)=>res.json(r || [])));

app.post('/api/teacher-teaching-students/bulk', (req, res) => {
    const { teacher_id, student_ids } = req.body;
    db.serialize(() => {
        db.run("DELETE FROM teacher_teaching_students WHERE teacher_id = ?", [teacher_id]);
        const stmt = db.prepare("INSERT INTO teacher_teaching_students (teacher_id, student_id) VALUES (?, ?)");
        student_ids.forEach(sid => stmt.run(teacher_id, sid));
        stmt.finalize();
        res.json({success: true});
    });
});

// 4. نطاق التدريس (Teaching Scope - Endpoint Fix)
// هذا الـ Endpoint يعالج المشكلة حيث يتم جلب الطلاب حتى لو لم يكن للأستاذ أي أفواج
app.get('/api/teachers/:id/scope', (req, res) => {
    const tid = req.params.id;
    const response = { levels: [], groups: [], students: [] };
    
    // أولاً: جلب الأفواج المسندة
    db.all(`SELECT g.id, g.name, g.level_id, l.name as level_name FROM teacher_groups tg JOIN groups g ON tg.group_id = g.id JOIN levels l ON g.level_id = l.id WHERE tg.teacher_id = ?`, [tid], (err, groups) => {
        
        // إذا حدث خطأ أو لم تكن هناك أفواج، نتعامل مع مصفوفة فارغة
        const groupsList = groups || [];
        response.groups = groupsList;
        
        // استخراج المستويات من الأفواج
        const levelsMap = new Map(); 
        groupsList.forEach(g => levelsMap.set(g.level_id, { id: g.level_id, name: g.level_name }));
        response.levels = Array.from(levelsMap.values());
        
        // تجهيز قائمة معرّفات الأفواج
        const groupIds = groupsList.length > 0 ? groupsList.map(g => g.id).join(',') : null;
        
        // الاستعلام عن طلاب الأفواج (إذا وجدت أفواج)
        const groupStudentsQuery = groupIds 
            ? `SELECT id, name, level_id, group_id, registration_number FROM users WHERE type='student' AND group_id IN (${groupIds})`
            : null;
            
        // دالة مساعدة لتنفيذ الوعد (Promise)
        const fetchGroupStudents = new Promise((resolve) => {
            if (!groupStudentsQuery) return resolve([]);
            db.all(groupStudentsQuery, [], (err, rows) => resolve(rows || []));
        });

        // الاستعلام عن طلاب المسندين فردياً (من جدول teacher_teaching_students)
        const individualStudentsQuery = `
            SELECT u.id, u.name, u.level_id, u.group_id, u.registration_number, l.name as level_name, g.name as group_name 
            FROM teacher_teaching_students tts 
            JOIN users u ON tts.student_id = u.id 
            LEFT JOIN levels l ON u.level_id = l.id 
            LEFT JOIN groups g ON u.group_id = g.id 
            WHERE tts.teacher_id = ?`;

        const fetchIndividualStudents = new Promise((resolve) => {
            db.all(individualStudentsQuery, [tid], (err, rows) => resolve(rows || []));
        });

        // تنفيذ الاستعلامين ودمج النتائج
        Promise.all([fetchGroupStudents, fetchIndividualStudents]).then(([gStudents, iStudents]) => {
            const allStudents = [...gStudents];
            
            // دمج الطلاب الفرديين مع تجنب التكرار
            iStudents.forEach(s => {
                if (!allStudents.find(existing => existing.id === s.id)) {
                    allStudents.push(s);
                }
            });

            response.students = allStudents;
            res.json(response);
        }).catch(e => {
            console.error(e);
            res.status(500).json({error: e.message});
        });
    });
});

// ==========================================
// ربط المحادثات الخاصة (Student-Teacher Links)
// ==========================================
app.get('/api/student-teacher-links', (req, res) => db.all(`SELECT l.*, s.name as student_name, t.name as teacher_name FROM student_teacher_links l JOIN users s ON s.id=l.student_id JOIN users t ON t.id=l.teacher_id`, [], (e,r)=>res.json(r || [])));

app.post('/api/student-teacher-links/bulk', (req, res) => {
    const { teacher_id, student_ids } = req.body;
    const stmt = db.prepare("INSERT OR IGNORE INTO student_teacher_links (student_id, teacher_id) VALUES (?, ?)");
    student_ids.forEach(sid => stmt.run(sid, teacher_id));
    stmt.finalize();
    res.json({success:true});
});

app.delete('/api/student-teacher-links', (req, res) => {
    const { student_id, teacher_id } = req.body;
    db.run("DELETE FROM student_teacher_links WHERE student_id = ? AND teacher_id = ?", [student_id, teacher_id], (e)=>res.json({success:true}));
});

// ==========================================
// مجموعات الدردشة (Chat Groups)
// ==========================================
app.get('/api/chat-groups', (req, res) => {
    db.all("SELECT * FROM chat_groups ORDER BY created_at DESC", [], (e, groups) => {
        if (e) return res.status(500).json({error:e.message});
        if (!groups || !groups.length) return res.json([]);
        
        const promises = groups.map(g => new Promise(resolve => {
            db.get("SELECT COUNT(*) as c FROM group_members WHERE group_id = ?", [g.id], (e, r) => {
                g.member_count = r ? r.c : 0;
                resolve(g);
            });
        }));
        
        Promise.all(promises).then(d => res.json(d));
    });
});

app.get('/api/chat-groups/:id/details', (req, res) => {
    db.get("SELECT * FROM chat_groups WHERE id = ?", [req.params.id], (e, group) => {
        if (!group) return res.status(404).json({error:'Not found'});
        db.all("SELECT gm.user_id, gm.is_admin, u.name, u.type FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?", [req.params.id], (e, members) => {
            group.members = members; 
            res.json(group);
        });
    });
});

app.get('/api/chat-groups/:id/members', (req, res) => {
    db.all("SELECT u.id, u.name, u.type, u.avatar, gm.is_admin FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? ORDER BY gm.is_admin DESC, u.name ASC", [req.params.id], (e,r)=>res.json(r || []));
});

app.post('/api/chat-groups', (req, res) => {
    const { name, allow_private, only_admins_can_send, members } = req.body;
    db.run("INSERT INTO chat_groups (name, allow_private_chat, only_admins_can_send) VALUES (?, ?, ?)", 
        [name, allow_private?1:0, only_admins_can_send?1:0], function(e) {
            const gid = this.lastID;
            if (members && members.length) {
                const stmt = db.prepare("INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)");
                members.forEach(m => stmt.run(gid, m.user_id, m.is_admin?1:0));
                stmt.finalize();
            }
            res.json({success:true, id:gid});
    });
});

app.put('/api/chat-groups/:id', (req, res) => {
    const { name, allow_private, only_admins_can_send, members } = req.body;
    db.serialize(() => {
        db.run("UPDATE chat_groups SET name = ?, allow_private_chat = ?, only_admins_can_send = ? WHERE id = ?", 
            [name, allow_private?1:0, only_admins_can_send?1:0, req.params.id]);
        
        db.run("DELETE FROM group_members WHERE group_id = ?", [req.params.id]);
        
        if (members && members.length) {
            const stmt = db.prepare("INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)");
            members.forEach(m => stmt.run(req.params.id, m.user_id, m.is_admin?1:0));
            stmt.finalize();
        }
        res.json({success:true});
    });
});

app.post('/api/chat-groups/:id/settings', (req, res) => {
    db.get("SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?", [req.params.id, req.body.user_id], (e, r) => {
        if (!r || !r.is_admin) return res.status(403).json({error:'Unauthorized'});
        db.run("UPDATE chat_groups SET only_admins_can_send = ? WHERE id = ?", [req.body.only_admins_can_send?1:0, req.params.id], ()=>res.json({success:true}));
    });
});

app.post('/api/chat-groups/delete', (req, res) => {
    const { id, password } = req.body;
    db.get("SELECT password FROM users WHERE username = 'admin'", (e, admin) => {
        if (bcrypt.compareSync(password, admin.password)) {
            db.serialize(() => {
                db.run("DELETE FROM chat_groups WHERE id = ?", [id]);
                db.run("DELETE FROM group_members WHERE group_id = ?", [id]);
                db.run("DELETE FROM messages WHERE group_id = ?", [id]);
                res.json({success:true});
            });
        } else {
            res.status(403).json({error:'Wrong password'});
        }
    });
});

app.get('/api/user/:id/chat-groups', (req, res) => {
    // إرجاع المجموعات التي ينتمي إليها المستخدم مع عدد الرسائل غير المقروءة
    db.all(`SELECT g.*, 
            (SELECT COUNT(*) FROM messages WHERE group_id = g.id AND read_at IS NULL AND sender_id != ?) as unread_count, 
            (SELECT sent_at FROM messages WHERE group_id = g.id ORDER BY sent_at DESC LIMIT 1) as last_msg_time, 
            gm.is_admin as my_role_admin 
            FROM chat_groups g 
            JOIN group_members gm ON g.id = gm.group_id 
            WHERE gm.user_id = ? 
            ORDER BY last_msg_time DESC NULLS LAST`, 
            [req.params.id, req.params.id], (e, r) => res.json(r || []));
});

app.get('/api/chat-groups/:id/messages', (req, res) => {
    db.all(`SELECT m.*, u.name as sender_name, u.avatar as sender_avatar 
            FROM messages m LEFT JOIN users u ON m.sender_id = u.id 
            WHERE m.group_id = ? ORDER BY m.sent_at ASC`, [req.params.id], (e, r) => res.json(r || []));
});

// ==========================================
// منطق المحادثة والرسائل (Chat Logic)
// ==========================================

// جلب جهات الاتصال للأستاذ (طلاب مرتبطون + الإدارة)
app.get('/api/teacher/:id/linked-students', (req, res) => {
    const teacherId = req.params.id;
    // تم تحديث الاستعلام لضمان جلب آخر وقت رسالة وعدد غير المقروء بشكل دقيق للمدير
    const query = `
        SELECT u.id, u.name, u.avatar, u.type, l.name as level_name, g.name as group_name,
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL) as unread_count,
        (SELECT sent_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time
        FROM users u
        LEFT JOIN levels l ON u.level_id = l.id
        LEFT JOIN groups g ON u.group_id = g.id
        JOIN student_teacher_links stl ON stl.student_id = u.id
        WHERE stl.teacher_id = ?
        
        UNION ALL
        
        SELECT id, name, avatar, type, 'إدارة' as level_name, '' as group_name,
        (SELECT COUNT(*) FROM messages WHERE sender_id = users.id AND receiver_id = ? AND read_at IS NULL) as unread_count,
        (SELECT sent_at FROM messages WHERE (sender_id = users.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = users.id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time
        FROM users WHERE type = 'admin'
        
        ORDER BY last_msg_time DESC NULLS LAST
    `;
    
    // المعاملات:
    // 1-3: للطالب (unread, last_msg 1, last_msg 2)
    // 4: شرط المعلم
    // 5-7: للمدير (unread, last_msg 1, last_msg 2)
    const params = [
        teacherId, teacherId, teacherId, // Students subqueries
        teacherId,                       // Teacher ID for WHERE clause
        teacherId, teacherId, teacherId  // Admin subqueries
    ];
    
    db.all(query, params, (e, r) => {
        if(e) console.error(e);
        res.json(r || []);
    });
});

// جلب جهات الاتصال للطالب (أساتذة مرتبطون) - تم إزالة الإدارة من هنا
app.get('/api/student/:id/linked-teachers', (req, res) => {
    const query = `
        SELECT u.id, u.name, u.avatar, u.type, (SELECT GROUP_CONCAT(s.name, ', ') FROM subjects s JOIN teacher_subjects ts ON ts.subject_id = s.id WHERE ts.teacher_id = u.id) as level_name, '' as group_name,
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL) as unread_count,
        (SELECT sent_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY sent_at DESC LIMIT 1) as last_msg_time
        FROM users u JOIN student_teacher_links stl ON stl.teacher_id = u.id WHERE stl.student_id = ?
        ORDER BY last_msg_time DESC NULLS LAST
    `;
    const params = [req.params.id, req.params.id, req.params.id, req.params.id];
    db.all(query, params, (e, r) => {
        if(e) console.error(e);
        res.json(r || []);
    });
});

// جلب رسائل المحادثة الفردية
app.get('/api/conversation/:u1/:u2', (req, res) => {
    db.all(`SELECT m.*, u.name as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY sent_at ASC`, [req.params.u1, req.params.u2, req.params.u2, req.params.u1], (e, r) => res.json(r));
});

// تحديد الرسائل كمقروءة
app.post('/api/conversation/mark-read', (req, res) => {
    if (req.body.group_id) {
        // في المجموعات، لا نقوم بتحديث حالة القراءة بنفس الطريقة حالياً لتجنب التعقيد
        res.json({success:true}); 
    } else {
        db.run("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL", [req.body.sender_id, req.body.reader_id], ()=>res.json({success:true}));
    }
});

// إرسال رسالة نصية
app.post('/api/message/send', (req, res) => {
    const { sender_id, receiver_id, group_id, message_text } = req.body;
    
    if (group_id) {
        // التحقق من صلاحيات النشر في المجموعة
        db.get("SELECT only_admins_can_send FROM chat_groups WHERE id=?", [group_id], (e,g)=>{
            if (g && g.only_admins_can_send) {
                db.get("SELECT type FROM users WHERE id=?", [sender_id], (e,u)=>{
                    if (u.type === 'admin') return insertMsg(); // المدير دائماً مسموح له
                    
                    db.get("SELECT is_admin FROM group_members WHERE group_id=? AND user_id=?", [group_id, sender_id], (e,m)=>{
                        if (m && m.is_admin) insertMsg(); 
                        else res.status(403).json({error:'Restricted'});
                    });
                });
            } else {
                insertMsg();
            }
        });
        
        function insertMsg() { 
            db.run("INSERT INTO messages (sender_id, group_id, message_text) VALUES (?, ?, ?)", [sender_id, group_id, message_text], ()=>res.json({success:true})); 
        }
    } else {
        // رسالة خاصة
        db.run("INSERT INTO messages (sender_id, receiver_id, message_text) VALUES (?, ?, ?)", [sender_id, receiver_id, message_text], function(err) {
            if (err) return res.status(500).json({error: err.message});
            
            // تحقق مما إذا كان المرسل هو المسؤول لإنشاء إشعار
            db.get("SELECT type FROM users WHERE id = ?", [sender_id], (e, user) => {
                if (user && user.type === 'admin') {
                    // نضع رابط "action:chat:SENDER_ID" لفتح المحادثة مباشرة
                    const actionLink = `action:chat:${sender_id}`;
                    db.run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)", 
                        [receiver_id, "لديك رسالة جديدة من الإدارة", actionLink]);
                }
            });
            
            res.json({success:true});
        });
    }
});

// إرسال ملف (صورة/مستند)
app.post('/api/message/upload', upload.single('file'), (req, res) => {
    const { sender_id, receiver_id, group_id } = req.body;
    const col = group_id ? "sender_id, group_id" : "sender_id, receiver_id";
    const val = group_id ? [sender_id, group_id] : [sender_id, receiver_id];
    
    db.run(`INSERT INTO messages (${col}, message_type, file_path, file_name, file_size) VALUES (?, ?, 'file', ?, ?, ?)`, 
        [...val, req.file.filename, req.file.originalname, req.file.size], 
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            
            if (!group_id) {
                // تحقق مما إذا كان المرسل هو المسؤول لإنشاء إشعار
                db.get("SELECT type FROM users WHERE id = ?", [sender_id], (e, user) => {
                    if (user && user.type === 'admin') {
                        // إشعار يفتح المحادثة
                        const actionLink = `action:chat:${sender_id}`;
                        db.run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)", 
                            [receiver_id, "أرسلت الإدارة ملفاً جديداً", actionLink]);
                    }
                });
            }
            res.json({success:true});
        }
    );
});

// ==========================================
// وظائف المسؤول (Admin Features)
// ==========================================

// البث الجماعي (Broadcast)
app.post('/api/admin/broadcast', upload.single('file'), (req, res) => {
    const recs = JSON.parse(req.body.recipients);
    const { sender_id, message_text } = req.body;
    
    db.serialize(() => {
        const stmtT = db.prepare("INSERT INTO messages (sender_id, receiver_id, message_text) VALUES (?, ?, ?)");
        const stmtF = db.prepare("INSERT INTO messages (sender_id, receiver_id, message_type, file_path, file_name, file_size) VALUES (?, ?, 'file', ?, ?, ?)");
        const stmtN = db.prepare("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)");
        
        recs.forEach(rid => {
            if (message_text) stmtT.run(sender_id, rid, message_text);
            if (req.file) stmtF.run(sender_id, rid, req.file.filename, req.file.originalname, req.file.size);
            
            // إرسال إشعار يفتح المحادثة
            const actionLink = `action:chat:${sender_id}`;
            stmtN.run(rid, "رسالة تعميم جديدة من الإدارة", actionLink);
        });
        
        stmtT.finalize(); 
        stmtF.finalize();
        stmtN.finalize();
        res.json({success:true});
    });
});

// حذف رسالة من قبل المسؤول
app.post('/api/admin/message/delete', (req, res) => {
    const { id, password } = req.body;
    db.get("SELECT password FROM users WHERE username='admin'", (e,a)=>{
        if (bcrypt.compareSync(password, a.password)) {
            db.run("DELETE FROM messages WHERE id=?", [id], ()=>res.json({success:true}));
        } else {
            res.status(403).json({error:'Password'});
        }
    });
});

// ==========================================
// نظام الدروس (Lessons System)
// ==========================================
app.post('/api/lessons', uploadLesson.single('file'), (req, res) => {
    const { teacher_id, subject_id, title, description, target_all, target_levels, target_groups, target_students } = req.body;
    const isAll = target_all === 'true';
    
    db.run(`INSERT INTO lessons (teacher_id, subject_id, title, description, file_path, target_all, target_levels, target_groups, target_students) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [teacher_id, subject_id, title, description, req.file.filename, isAll, target_levels, target_groups, target_students],
    function(err) {
        if (err) return res.status(500).json({error:err});
        
        // إنشاء إشعارات للمستخدمين المستهدفين
        const msg = `درس جديد: ${title}`;
        let sql = "SELECT id FROM users WHERE type='student'";
        
        if (!isAll) {
            const conditions = [];
            if (target_students) conditions.push(`id IN (${target_students})`);
            if (target_groups) conditions.push(`group_id IN (${target_groups})`);
            if (target_levels) conditions.push(`level_id IN (${target_levels})`);
            
            if (conditions.length) sql += ` AND (${conditions.join(' OR ')})`;
            else return res.json({success:true}); // لا يوجد مستهدفون
        }
        
        db.all(sql, [], (e, rows) => {
            if (rows && rows.length) { 
                const s = db.prepare("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)"); 
                rows.forEach(u => s.run(u.id, msg, `/api/lessons/files/${req.file.filename}`)); 
                s.finalize(); 
            }
        });
        res.json({success:true});
    });
});

app.get('/api/lessons', (req, res) => {
    const { user_id, user_group, user_level } = req.query;
    db.all(`SELECT l.*, u.name as teacher_name, u.type as teacher_type, s.name as subject_name FROM lessons l LEFT JOIN users u ON l.teacher_id = u.id LEFT JOIN subjects s ON l.subject_id = s.id ORDER BY l.created_at DESC`, [], (e, rows) => {
        if (!user_id) return res.json(rows);
        
        const filtered = rows.filter(l => {
            if (l.target_all) return true;
            if (l.target_students && l.target_students.split(',').includes(String(user_id))) return true;
            if (l.target_groups && user_group && l.target_groups.split(',').includes(String(user_group))) return true;
            if (l.target_levels && user_level && l.target_levels.split(',').includes(String(user_level))) return true;
            return false;
        });
        res.json(filtered);
    });
});

app.delete('/api/lessons/:id', (req, res) => db.run("DELETE FROM lessons WHERE id=?", [req.params.id], ()=>res.json({success:true})));

app.get('/api/lessons/files/:f', (req, res) => { 
    const p = path.join(__dirname,'uploads/lessons',req.params.f); 
    if (fs.existsSync(p)) res.sendFile(p); 
    else res.status(404).send('Not found'); 
});

// مسار جديد لملفات الدردشة (يقرأ من مجلد uploads مباشرة)
app.get('/api/chat/files/:f', (req, res) => { 
    const p = path.join(__dirname, 'uploads', req.params.f); 
    if (fs.existsSync(p)) res.sendFile(p); 
    else res.status(404).send('Not found'); 
});

app.get('/api/teachers/:id/lessons', (req, res) => db.all(`SELECT l.*, s.name as subject_name FROM lessons l LEFT JOIN subjects s ON l.subject_id = s.id WHERE l.teacher_id = ? ORDER BY l.created_at DESC`, [req.params.id], (e,r)=>res.json(r)));

// ==========================================
// الإشعارات (Notifications)
// ==========================================
app.get('/api/notifications/:uid', (req, res) => db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [req.params.uid], (e,r)=>res.json(r)));

app.post('/api/notifications/read/:id', (req, res) => db.run("UPDATE notifications SET is_read=1 WHERE id=?", [req.params.id], ()=>res.json({success:true})));

// نقطة اتصال لمسح جميع الإشعارات لمستخدم معين
app.post('/api/notifications/clear/:uid', (req, res) => {
    db.run("DELETE FROM notifications WHERE user_id = ?", [req.params.uid], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// ==========================================
// لوحة التحكم والإحصائيات (Admin Dashboard)
// ==========================================
app.get('/api/admin/stats', (req, res) => {
    const stats = {};
    db.serialize(() => {
        db.get("SELECT COUNT(*) as c FROM users WHERE type='teacher'", (e,r)=>stats.teachers=r.c);
        db.get("SELECT COUNT(*) as c FROM users WHERE type='student'", (e,r)=>stats.students=r.c);
        db.get("SELECT COUNT(*) as c FROM messages", (e,r)=>stats.messages=r.c);
        db.get("SELECT COUNT(*) as c FROM subjects", (e,r)=>stats.subjects=r.c);
        db.get("SELECT COUNT(*) as c FROM student_teacher_links", (e,r)=>stats.links=r.c);
        db.get("SELECT COUNT(*) as c FROM lessons", (e,r)=>stats.lessons=r.c);
        // تم تحديث الاستعلام لعد الطالبات فقط اللواتي سجلن الدخول
        db.get("SELECT COUNT(*) as c FROM users WHERE type='student' AND login_count > 0", (e,r)=> { stats.active_users=r.c; res.json(stats); });
    });
});

app.get('/api/admin/usage-stats', (req, res) => db.all("SELECT id, name, type, login_count, last_login FROM users WHERE login_count > 0 ORDER BY last_login DESC", (e,r)=>res.json(r)));

app.post('/api/admin/reset-stats', (req, res) => { 
    if (req.body.code === DEV_RESET_CODE) {
        db.run("UPDATE users SET login_count=0, last_login=NULL", ()=>res.json({success:true}));
    } else {
        res.status(403).json({error:'Invalid code'}); 
    }
});

app.get('/api/admin/conversations', (req, res) => {
    db.all(`SELECT u1.id as user1_id, u1.name as user1_name, u1.type as user1_type, u2.id as user2_id, u2.name as user2_name, u2.type as user2_type, COUNT(m.id) as msg_count, MAX(m.sent_at) as last_message_at, NULL as group_id, NULL as group_name FROM messages m JOIN users u1 ON m.sender_id=u1.id JOIN users u2 ON m.receiver_id=u2.id WHERE m.group_id IS NULL GROUP BY CASE WHEN u1.id < u2.id THEN u1.id ELSE u2.id END, CASE WHEN u1.id < u2.id THEN u2.id ELSE u1.id END UNION ALL SELECT NULL, NULL, NULL, NULL, NULL, NULL, COUNT(m.id), MAX(m.sent_at), g.id, g.name FROM messages m JOIN chat_groups g ON m.group_id=g.id WHERE m.group_id IS NOT NULL GROUP BY g.id ORDER BY last_message_at DESC`, [], (e,r)=>res.json(r));
});

app.get('/api/admin/inbox-summary', (req, res) => {
    db.all(`SELECT u.id as other_id, u.name as other_name, u.type as other_type, m.message_text, m.sent_at, m.read_at, m.sender_id FROM messages m JOIN users u ON (m.sender_id = u.id OR m.receiver_id = u.id) WHERE (m.receiver_id = (SELECT id FROM users WHERE type='admin' LIMIT 1) OR m.sender_id = (SELECT id FROM users WHERE type='admin' LIMIT 1)) AND u.type != 'admin' ORDER BY m.sent_at DESC`, [], (e, rows) => {
        const convs = {};
        rows.forEach(r => {
            if (!convs[r.other_id]) convs[r.other_id] = { id: r.other_id, name: r.other_name, type: r.other_type, last_message: r.message_text, last_time: r.sent_at, unread_count: 0 };
            if (r.sender_id == r.other_id && !r.read_at) convs[r.other_id].unread_count++;
        });
        res.json(Object.values(convs));
    });
});

// ==========================================
// أدوات عامة (Utilities)
// ==========================================

// الحذف الجماعي
app.post('/api/bulk-delete', (req, res) => {
    const { ids, type } = req.body;
    let tbl = '';
    if (type === 'student' || type === 'teacher') tbl = 'users';
    else tbl = type + 's';
    
    if (tbl && ids.length) {
        db.run(`DELETE FROM ${tbl} WHERE id IN (${ids.join(',')})`, () => res.json({success:true}));
    } else {
        res.status(400).json({error: 'Invalid Request'});
    }
});

// الحذف التسلسلي للمستخدم (يحذف كل شيء مرتبط به)
app.delete('/api/users/:id', (req, res) => {
    const uid = req.params.id;
    db.serialize(() => {
        db.run("DELETE FROM users WHERE id=?", [uid]);
        db.run("DELETE FROM student_teacher_links WHERE student_id=? OR teacher_id=?", [uid, uid]);
        db.run("DELETE FROM teacher_subjects WHERE teacher_id=?", [uid]);
        db.run("DELETE FROM teacher_groups WHERE teacher_id=?", [uid]);
        db.run("DELETE FROM teacher_teaching_students WHERE teacher_id=?", [uid]);
        db.run("DELETE FROM group_members WHERE user_id=?", [uid]);
        // لا نحذف الرسائل للحفاظ على الأرشيف، أو يمكن حذفها حسب السياسة
        res.json({success:true});
    });
});

// ==========================================
// SPA Fallback Handler
// ==========================================
// هذا يضمن أن التحديث (F5) في الصفحات الأمامية لا يعطي خطأ 404
app.get('*', (req, res) => {
    // تجاهل طلبات API المفقودة
    if (req.path.startsWith('/api')) return res.status(404).json({error:'Not found'});
    
    // توجيهات محددة للصفحات الرئيسية
    if (req.path === '/chat') return res.sendFile(path.join(__dirname, 'public', 'chat.html'));
    if (req.path === '/admin') return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    
    // التحقق من وجود الملف فعلياً
    const pub = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(pub) && fs.lstatSync(pub).isFile()) return res.sendFile(pub);
    
    // العودة إلى الصفحة الرئيسية (Login)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// تشغيل الخادم (Server Start)
// ==========================================
function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`=========================================`);
        console.log(`Server running on port ${port}`);
        console.log(`Access: http://localhost:${port}`);
        console.log(`=========================================`);
    });
    
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`Port ${port} is busy, trying ${port+1}...`);
            startServer(port + 1);
        } else {
            console.error(e);
        }
    });
}

startServer(DEFAULT_PORT);