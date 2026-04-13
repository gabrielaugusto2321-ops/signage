# SignageOS — Digital Signage System

Sistema de mídia indoor para Smart TVs, navegadores e TV Box.

---

## 📁 Estrutura de Arquivos

```
signage/
├── index.html    → Player principal (tela cheia)
├── admin.html    → Painel de administração
├── styles.css    → Estilos unificados
├── storage.js    → Camada de dados (localStorage / Firebase-ready)
├── app.js        → Lógica do player
├── admin.js      → Lógica do painel admin
└── README.md
```

---

## 🚀 Como Usar

### 1. Rodar Localmente

Basta abrir os arquivos em qualquer servidor HTTP local:

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Live Server (VS Code)
# Clique com botão direito → "Open with Live Server"
```

Acesse:
- **Player:** `http://localhost:8080/index.html`
- **Admin:**  `http://localhost:8080/admin.html`

### 2. Smart TV / TV Box

- Abra o navegador da TV
- Navegue para o IP da máquina onde o servidor está rodando
  - Ex: `http://192.168.1.100:8080/index.html`
- Para modo kiosk (Chrome/Chromium):
  ```bash
  chromium-browser --kiosk http://localhost:8080/index.html
  ```

---

## ⚙️ Configuração Inicial

1. Abra `admin.html`
2. Vá em **Configurações**
3. Defina o **YouTube Video ID** (só o ID, não a URL)
4. Ajuste o **Intervalo entre anúncios** (padrão: 2 minutos)
5. Salve as configurações

---

## 📺 Adicionar Anúncios

### Via Upload (recomendado para arquivos locais):
1. Admin → **Upload**
2. Arraste um arquivo de vídeo MP4
3. Preencha nome, duração, prioridade
4. Clique em **Salvar Anúncio**

### Via URL:
1. Admin → **Anúncios** → **+ Novo Anúncio**
2. Insira a URL direta do vídeo (MP4, WebM)
3. Salve

---

## 🔄 Sync Admin → Player

O Admin e o Player se comunicam via **BroadcastChannel** (sem precisar de servidor).
Ambas as abas precisam estar abertas no mesmo navegador.

Mensagens suportadas:
- `CONFIG_UPDATED` — Atualiza configurações no player
- `ADS_UPDATED` — Reconstrói fila de anúncios
- `FORCE_AD` — Força exibição imediata de um anúncio
- `RESET_TIMER` — Reinicia o timer de agendamento
- `CHANGE_YT` — Troca o vídeo do YouTube

---

## 🔥 Migrar para Firebase (Opcional)

O arquivo `storage.js` foi projetado para substituição fácil:

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com)
2. Ative Firestore Database
3. Substitua as funções em `storage.js`:
   - `getAds()` → `getDocs(collection(db, 'video_ads'))`
   - `saveAd()` → `setDoc(doc(db, 'video_ads', id), data)`
   - `getConfig()` → `getDoc(doc(db, 'config', 'main'))`

---

## 📐 Estrutura de Dados

### Anúncio (video_ads):
```json
{
  "id": "ad_001",
  "name": "Promo Verão",
  "url": "https://example.com/video.mp4",
  "duration": 30,
  "priority": 3,
  "active": true,
  "tags": ["promo", "verão"],
  "createdAt": 1700000000000
}
```

### Config:
```json
{
  "youtube": {
    "videoId": "jfKfPfyJRdk",
    "startAt": 0,
    "muted": true,
    "loop": true
  },
  "schedule": {
    "intervalMinutes": 2,
    "maxSequential": 1,
    "rotation": "sequential",
    "showSkipBtn": true
  },
  "ui": {
    "pipPosition": "bottom-right",
    "showStatusBar": true,
    "transitions": true
  }
}
```

---

## 🖥️ Compatibilidade

| Plataforma         | Status |
|--------------------|--------|
| Chrome / Chromium  | ✅     |
| Firefox            | ✅     |
| Samsung Smart TV   | ✅     |
| LG webOS           | ✅     |
| Android TV Box     | ✅     |
| Raspberry Pi (kiosk) | ✅   |
| Safari (iOS)       | ⚠️ Autoplay restrito |

---

## 📦 Dependências Externas

- Google Fonts: `Syne` + `DM Mono`
- YouTube IFrame Player API (CDN)
- Nenhuma biblioteca JS adicional

---

## 🔐 Notas de Segurança

- O painel admin não possui autenticação no modo localStorage
- Para produção, adicione autenticação Firebase Auth
- Vídeos de URLs externas devem suportar CORS

---

Desenvolvido com SignageOS © 2025
