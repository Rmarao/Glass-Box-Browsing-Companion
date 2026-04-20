# 🤖 AI Concierge: The Context-Aware Browsing Companion

Welcome to the AI Concierge repository! This Chrome Extension solves "Tab Fatigue" by living directly in your browser. It reads the live webpage you are looking at and answers your questions using **Live Context Extraction** and **Glass-Box Transparency** (showing its exact Chain-of-Thought).

## 🛠️ Tech Stack
* **Frontend:** Chrome Extension Manifest V3 (Vanilla JS, HTML, CSS)
* **Backend:** Python & FastAPI
* **AI Engine:** Google Gemini 2.5 Flash

---

## 🚀 How to Set Up the Project Locally

Follow these steps to clone the project and get it running on your own machine.

### Prerequisites
* Python 3.8+ installed on your machine.
* Google Chrome.
* A free Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Step 1: Clone the Repository
Open your terminal and clone this repo to your local machine:
```bash
git clone https://github.com/prxnxv07/ai-concierge-hackathon.git
cd ai-concierge-hackathon
```

### Step 2: Set Up the Backend Brain
We need to create an isolated Python environment and install the required packages (FastAPI, Uvicorn, Google GenAI).

**For Mac/Linux:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 3: Add Your Secret API Key
1. Inside the `backend` folder, create a new file named exactly **`.env`**.
2. Paste your Gemini API key inside it like this:
```env
GEMINI_API_KEY=AIzaSy...your_key_here
```

### Step 4: Boot Up the Server
With your virtual environment still activated, start the local backend server:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Step 5: Install the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`
2. Turn on **Developer mode** (toggle in the top right).
3. Click the **Load unpacked** button (top left).
4. Select the `ai-concierge-hackathon` root folder.
5. Pin the extension to your toolbar, open a complex webpage, and start chatting!
