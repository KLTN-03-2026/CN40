function showMessage(message, isSuccess = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSuccess ? 'success' : 'error'}`;
    messageDiv.textContent = message;
    
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        font-weight: bold;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
        ${isSuccess ? 'background-color: #4CAF50;' : 'background-color: #f44336;'}
    `;
    
    if (!document.querySelector('#message-styles')) {
        const style = document.createElement('style');
        style.id = 'message-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

function setButtonLoading(button, isLoading) {
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.textContent = 'Đang xử lý...';
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || button.textContent;
    }
}

function handleRegister() {
    const registerForm = document.getElementById('registerForm');
    if (!registerForm) return;

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitButton = registerForm.querySelector('button[type="submit"]');
        setButtonLoading(submitButton, true);
        
        const formData = new FormData(registerForm);
        const data = {
            username: formData.get('username'),
            password: formData.get('password'),
            confirmPassword: formData.get('confirmPassword'),
       
        };
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessage(result.message, true);
                registerForm.reset();
                
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
                
            } else {
                showMessage(result.message, false);
            }
            
        } catch (error) {
            console.error('Lỗi:', error);
            showMessage('Có lỗi xảy ra! Vui lòng thử lại.', false);
        } finally {
            setButtonLoading(submitButton, false);
        }
    });
}

function handleLogin() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitButton = loginForm.querySelector('button[type="submit"]');
        setButtonLoading(submitButton, true);
        
        const formData = new FormData(loginForm);
        const data = {
            username: formData.get('username'),
            password: formData.get('password')
        };
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessage(result.message, true);
                
                sessionStorage.setItem('currentUser', JSON.stringify(result.user));
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);
                
            } else {
                showMessage(result.message, false);
            }
            
        } catch (error) {
            console.error('Lỗi:', error);
            showMessage('Có lỗi xảy ra! Vui lòng thử lại.', false);
        } finally {
            setButtonLoading(submitButton, false);
        }
    });
}

function handleHomePage() {
    const currentUser = sessionStorage.getItem('currentUser');
    
    if (currentUser) {
        const user = JSON.parse(currentUser);
        
        const userInfo = document.getElementById('userInfo');
        if (userInfo) {
            userInfo.innerHTML = `
                <div class="user-welcome">
                    <h2>Chào mừng, ${user.hoTen}!</h2>
                    <p>Ten: ${user.username}</p>
                </div>
            `;
        }
        
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.style.display = 'block';
            logoutBtn.addEventListener('click', handleLogout);
        }
        
        const authButtons = document.querySelectorAll('.auth-buttons');
        authButtons.forEach(btn => btn.style.display = 'none');
        
    } else {
        const guestInfo = document.getElementById('guestInfo');
        if (guestInfo) {
            guestInfo.innerHTML = `
                <div class="guest-welcome">
                    <h2>Chào mừng đến với hệ thống!</h2>
                    <p>Vui lòng đăng nhập để sử dụng đầy đủ tính năng.</p>
                </div>
            `;
        }
    }
}

function handleLogout() {
    sessionStorage.removeItem('currentUser');
    
    showMessage('Đăng xuất thành công!', true);
    
    setTimeout(() => {
        window.location.href = '/login';
    }, 1000);
}

function setupFormValidation() {
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        const passwordField = registerForm.querySelector('input[name="password"]');
        const confirmPasswordField = registerForm.querySelector('input[name="confirmPassword"]');
        const emailField = registerForm.querySelector('input[name="username"]');
        
        if (emailField) {
            emailField.addEventListener('blur', () => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (emailField.value && !emailRegex.test(emailField.value)) {
                    emailField.style.borderColor = '#f44336';
                    showMessage('Email không hợp lệ!', false);
                } else {
                    emailField.style.borderColor = '#ddd';
                }
            });
        }
        
        if (passwordField) {
            passwordField.addEventListener('input', () => {
                if (passwordField.value.length > 0 && passwordField.value.length < 6) {
                    passwordField.style.borderColor = '#f44336';
                } else {
                    passwordField.style.borderColor = '#ddd';
                }
            });
        }
        
        if (confirmPasswordField && passwordField) {
            confirmPasswordField.addEventListener('input', () => {
                if (confirmPasswordField.value !== passwordField.value) {
                    confirmPasswordField.style.borderColor = '#f44336';
                } else {
                    confirmPasswordField.style.borderColor = '#4CAF50';
                }
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Frontend đã sẵn sàng!');
    
    const currentPath = window.location.pathname;
    
    switch (currentPath) {
        case '/':
            handleHomePage();
            break;
        case '/login':
            handleLogin();
            setupFormValidation();
            break;
        case '/register':
            handleRegister();
            setupFormValidation();
            break;
        default:
            console.log('Trang không xác định');
    }
    
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.style.transition = 'opacity 0.3s ease';
    });
});


function isLoggedIn() {
    return sessionStorage.getItem('currentUser') !== null;
}

function getCurrentUser() {
    const userData = sessionStorage.getItem('currentUser');
    return userData ? JSON.parse(userData) : null;
}

function requireAuth() {
    if (!isLoggedIn()) {
        showMessage('Vui lòng đăng nhập để truy cập!', false);
        setTimeout(() => {
            window.location.href = '/login';
        }, 1000);
        return false;
    }
    return true;
}

function requireGuest() {
    if (isLoggedIn()) {
        showMessage('Bạn đã đăng nhập rồi!', true);
        setTimeout(() => {
            window.location.href = '/';
        }, 1000);
        return false;
    }
    return true;
}