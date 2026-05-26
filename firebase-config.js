import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA-vIm-4bfeI73KIBTXfkUCaW2sLu5jRzc",
    authDomain: "lws5737-a6105.firebaseapp.com",
    projectId: "lws5737-a6105",
    storageBucket: "lws5737-a6105.firebasestorage.app",
    messagingSenderId: "729062934950",
    appId: "1:729062934950:web:615529a26e02081c182767",
    measurementId: "G-LVB2WTXNGV"
};

let app, auth, db, provider;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    
    // 오프라인 캐시 지속성 적용
    enableIndexedDbPersistence(db).catch(() => {});
    
    provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
    console.error("클라우드 서버 연결 오류:", e);
}

export { auth, db, provider };
