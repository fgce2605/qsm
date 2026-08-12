# QC Stock Manager — Live Deployment Guide

Isme app ko GitHub par push karke Vercel se free live karne ke steps hain,
saath hi Supabase (cloud database) setup — jisse ye app kisi bhi device/phone
se open karne par same data dikhayega, real-time sync ke saath.

## 1. Supabase project banao (free)

1. https://supabase.com par jao, sign up karo, **New Project** banao.
2. Project ban jaane ke baad, left sidebar me **SQL Editor** kholo.
3. Is folder ki `supabase-schema.sql` file ka poora content copy karke
   paste karo aur **Run** dabao. Isse ek `kv_store` table ban jayega jisme
   app ka saara data (items, categories, receipts, issues, indents) save hoga.
4. Left sidebar me **Project Settings → API** kholo. Yahan se do cheezein copy karo:
   - **Project URL** (jaise `https://xxxxx.supabase.co`)
   - **anon public key** (lambi string)

## 2. Local .env file banao

Is project folder me `.env.example` ko copy karke `.env` naam se save karo,
aur upar copy kiye hue URL/key daal do:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## 3. Local me test karo (optional but recommended)

```bash
npm install
npm run dev
```

Browser me `http://localhost:5173` khol ke check karo sab tabs kaam kar rahe hain.

## 4. GitHub par push karo

```bash
git init
git add .
git commit -m "QC Stock Manager - initial version"
git branch -M main
git remote add origin https://github.com/<your-username>/qc-stock-manager.git
git push -u origin main
```

(`.env` file `.gitignore` me hai, isliye wo GitHub par nahi jayegi — ye zaroori
hai kyunki usme aapki keys hain.)

## 5. Vercel par live karo (free)

1. https://vercel.com par GitHub account se login karo.
2. **Add New Project** → apna `qc-stock-manager` GitHub repo select karo.
3. Vercel khud Vite project detect kar lega. Deploy se pehle
   **Environment Variables** section me ye do daalo (same jo `.env` me the):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. **Deploy** dabao. 1-2 minute me ek live URL mil jayega
   (jaise `qc-stock-manager.vercel.app`) — ye kisi bhi phone/laptop se khulega
   aur data sabme sync rahega.

## GitHub Pages ka option

GitHub Pages bhi use kar sakte ho (`vite build` + `gh-pages` package), lekin
Vercel isse simpler hai kyunki environment variables aur auto-deploy khud
handle karta hai har git push par. Agar GitHub Pages hi chahiye to bata dena,
uske steps alag se de dunga.

## Security note

`kv_store` table abhi anon key se open read/write allow karta hai — koi bhi
jiske paas aapka Supabase URL + anon key hai wo data dekh/edit kar sakta hai.
Ye internal lab tool ke liye theek hai (jab tak URL/key share na karo), lekin
agar aage login/password-based access chahiye to Supabase Auth add karke
har user ka apna login bhi banaya ja sakta hai — bata dena.
