function addStudent(studentData) {
    return new Promise(async (resolve, reject) => {
        // إنشاء رقم تسجيل تلقائي إذا لم يتم تقديمه
        if (!studentData.registration_number) {
            const year = new Date().getFullYear();
            const lastStudent = await getLastStudent();
            const nextNumber = lastStudent ? parseInt(lastStudent.registration_number.slice(-3)) + 1 : 1;
            studentData.registration_number = `${year}${nextNumber.toString().padStart(3, '0')}`;
        }

        // استخدام رقم التسجيل ككلمة مرور إذا لم يتم تقديم كلمة مرور
        const passwordToUse = studentData.password || studentData.registration_number;
        const hashedPassword = await bcrypt.hash(passwordToUse, 10);
        
        db.run(`INSERT INTO users (name, username, password, type, registration_number, avatar) 
                VALUES (?, ?, ?, 'student', ?, ?)`,
            [
                studentData.name,
                studentData.username,
                hashedPassword,
                studentData.registration_number,
                studentData.avatar || studentData.name.charAt(0)
            ], 
            function(err) {
                if (err) reject(err);
                else resolve({ 
                    id: this.lastID, 
                    registration_number: studentData.registration_number 
                });
            }
        );
    });
}