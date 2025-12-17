// ضع هذا الملف في public/js/chat-upload-fixes.js ثم أضف <script src="/js/chat-upload-fixes.js"></script> في chat.html
// أو انسخ الدوال أدناه واستبدل النسخ القديمة في chat.html

// Robust file upload handler for message files and lesson quick upload.
// Expects server endpoints:
//  - POST /api/message/upload    (multer single('file'))
//  - POST /api/lessons           (multer single('file'))

(function () {
  // Replace or reuse your existing globals: currentUser, currentReceiver, currentSubjectId
  // If these are declared elsewhere in chat.html, this code will reference them.

  // Ensure file input exists and wire events (id="fileUpload" and attach button id="attachBtn")
  function initFileUploadBindings() {
    const fileUpload = document.getElementById('fileUpload');
    if (fileUpload) {
      fileUpload.addEventListener('change', () => {
        const f = fileUpload.files[0];
        if (f) handleMessageFileUpload(f);
        fileUpload.value = '';
      });
    }

    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        if (!currentReceiver) return alert('يرجى اختيار محادثة أولاً');
        if (!fileUpload) return alert('عنصر رفع الملفات غير موجود');
        fileUpload.click();
      });
    }

    // if you have a visible file element for lessons (id="lessonFileInput" or "l_file"), leave it
  }

  // Helper to show friendly errors
  function showClientError(msg) {
    // Prefer modal/alert according to your UI; fallback to alert
    if (typeof alert === 'function') alert(msg);
    else console.error(msg);
  }

  // Upload file attached to a message
  async function handleMessageFileUpload(file) {
    try {
      if (!currentReceiver) {
        showClientError('اختر محادثة أولاً لرفع الملف.');
        return;
      }
      if (!currentUser || !currentUser.id) {
        showClientError('المستخدم غير مسجّل الدخول بشكل صحيح.');
        return;
      }

      const fd = new FormData();
      // IMPORTANT: server expects field name 'file'
      fd.append('file', file);
      fd.append('sender_id', currentUser.id);
      fd.append('receiver_id', currentReceiver);
      if (typeof currentSubjectId !== 'undefined' && currentSubjectId !== null) {
        fd.append('subject_id', currentSubjectId);
      }

      // optional: show a simple uploading state
      const prevBtn = document.getElementById('sendBtn');
      if (prevBtn) { prevBtn.disabled = true; }

      const resp = await fetch('/api/message/upload', {
        method: 'POST',
        body: fd
      });

      if (!resp.ok) {
        // try to parse error body
        let text;
        try { text = await resp.text(); } catch (e) { text = resp.statusText; }
        console.error('Upload failed', resp.status, text);
        showClientError('فشل رفع الملف. الرجاء التحقق من نوع الملف والحجم. (رمز: ' + resp.status + ')');
      } else {
        const result = await resp.json();
        // server returns { success: true, message: { ... } } on success
        if (result && result.success) {
          // refresh conversation to show file message
          if (typeof loadConversation === 'function') {
            await loadConversation();
          }
        } else {
          console.warn('Unexpected upload response', result);
          showClientError(result.error || 'تم رفع الملف لكن الخادم لم يرجع نتيجة متوقعة.');
        }
      }
    } catch (err) {
      console.error('handleMessageFileUpload error', err);
      showClientError('حدث خطأ أثناء رفع الملف. تحقق من سجل الخادم.');
    } finally {
      const prevBtn = document.getElementById('sendBtn');
      if (prevBtn) { prevBtn.disabled = false; }
    }
  }

  // Expose to global so existing code can call it
  window.handleMessageFileUpload = handleMessageFileUpload;

  // Lesson quick upload (teacher)
  async function uploadLessonQuickFromElements(teacherId, title, description, subjectId, file) {
    if (!teacherId) { showClientError('اختر الأستاذ المسؤول عن الدرس'); return; }
    if (!title) { showClientError('ضع عنوان الدرس'); return; }
    if (!file) { showClientError('اختر ملف الدرس'); return; }
    try {
      const fd = new FormData();
      fd.append('teacher_id', teacherId);
      fd.append('title', title);
      fd.append('description', description || '');
      if (subjectId) fd.append('subject_id', subjectId);
      fd.append('file', file);

      const resp = await fetch('/api/lessons', { method: 'POST', body: fd });
      if (!resp.ok) {
        let text;
        try { text = await resp.text(); } catch (e) { text = resp.statusText; }
        console.error('Lesson upload failed', resp.status, text);
        showClientError('فشل رفع الدرس (رمز: ' + resp.status + '). تحقق من حجم الملف ونوعه.');
        return;
      }
      const data = await resp.json();
      if (data && data.success) {
        if (typeof loadAllLessons === 'function') await loadAllLessons();
        if (typeof loadLessonsData === 'function') await loadLessonsData();
        showClientError('تم رفع الدرس بنجاح');
      } else {
        console.warn('Unexpected lesson upload response', data);
        showClientError(data.error || 'فشل رفع الدرس');
      }
    } catch (err) {
      console.error('uploadLessonQuick error', err);
      showClientError('حدث خطأ أثناء رفع الدرس. راجع سجل الخادم.');
    }
  }

  window.uploadLessonQuickFromElements = uploadLessonQuickFromElements;

  // initialize bindings on load
  document.addEventListener('DOMContentLoaded', () => {
    try { initFileUploadBindings(); } catch (e) { console.error(e); }
  });
})();