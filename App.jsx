import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { 
  Users, AlertTriangle, CheckCircle, TrendingUp, BookOpen, 
  Map as MapIcon, Settings, LogOut, Menu, X, Download, Plus, 
  Search, Filter, Activity, FileText, Phone, MapPin, Info,
  Book, UserPlus, Heart, Printer, Check, Copy
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer 
} from 'recharts';

// --- CONSTANTS & CONFIG ---
const COLORS = {
  primary: '#0f766e', // Teal 700
  primaryHover: '#0d9488', // Teal 600
  low: '#22c55e', // Green 500
  medium: '#f59e0b', // Amber 500
  high: '#ef4444', // Red 500
  bg: '#f8fafc',
  card: '#ffffff'
};

const DISTRICTS = ['Bengaluru Urban', 'Mysuru', 'Belagavi', 'Kalaburagi', 'Raichur'];
const TRANSLATIONS = {
  en: { 
    dashboard: 'Dashboard', students: 'Students', attendance: 'Attendance', 
    marks: 'Marks', earlyWarning: 'Early Warning', interventions: 'Interventions',
    counselling: 'Counselling', notifications: 'Parent Notifications', 
    scholarships: 'Scholarships', geo: 'Geographical', reenrolment: 'Re-enrolment',
    settings: 'Settings & About'
  },
  kn: {
    dashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್', students: 'ವಿದ್ಯಾರ್ಥಿಗಳು', attendance: 'ಹಾಜರಾತಿ',
    marks: 'ಅಂಕಗಳು', earlyWarning: 'ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ', interventions: 'ಮಧ್ಯಸ್ಥಿಕೆಗಳು',
    counselling: 'ಆಪ್ತ ಸಮಾಲೋಚನೆ', notifications: 'ಪಾಲಕರ ಸೂಚನೆಗಳು',
    scholarships: 'ವಿದ್ಯಾರ್ಥಿವೇತನ', geo: 'ಭೌಗೋಳಿಕ', reenrolment: 'ಮರು-ದಾಖಲಾತಿ',
    settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು'
  },
  hi: {
    dashboard: 'डैशबोर्ड', students: 'छात्र', attendance: 'उपस्थिति',
    marks: 'अंक', earlyWarning: 'प्रारंभिक चेतावनी', interventions: 'हस्तक्षेप',
    counselling: 'परामर्श', notifications: 'अभिभावक सूचनाएं',
    scholarships: 'छात्रवृत्ति', geo: 'भौगोलिक', reenrolment: 'पुनः नामांकन',
    settings: 'सेटिंग्स'
  }
};

// --- RISK ENGINE (/lib/riskModel.ts embedded) ---
const calculateRisk = (student, attendanceList, marksList) => {
  // Factors & Weights
  const weights = {
    attendance: 25,
    consecutiveAbs: 15,
    failedSubjects: 15,
    marksDecline: 10,
    financial: 10,
    distanceTransport: 8,
    guardianEd: 5,
    health: 4,
    familyResp: 5,
    ageMismatch: 3
  };

  // Default values
  let attScore = 0, consAbsScore = 0, failScore = 0, declineScore = 0;
  
  // Calculate Attendance Stats
  let totalDays = 0, presentDays = 0, maxConsecutiveAbs = 0, currentConsAbs = 0;
  attendanceList.forEach(a => {
    totalDays++;
    if (a.status === 'Present') {
      presentDays++;
      currentConsAbs = 0;
    } else {
      currentConsAbs++;
      if (currentConsAbs > maxConsecutiveAbs) maxConsecutiveAbs = currentConsAbs;
    }
  });
  
  const attPercentage = totalDays > 0 ? (presentDays / totalDays) * 100 : 100;
  // Normalize attendance (worse if below 75%)
  if (attPercentage < 50) attScore = 1;
  else if (attPercentage < 75) attScore = (75 - attPercentage) / 25; // 0 to 1

  if (maxConsecutiveAbs >= 7) consAbsScore = 1;
  else if (maxConsecutiveAbs >= 3) consAbsScore = maxConsecutiveAbs / 7;

  // Calculate Marks Stats
  let failedCount = 0;
  let lastExamAvg = 100, prevExamAvg = 100;
  
  const exam1 = marksList.find(m => m.exam === 'Midterm');
  const exam2 = marksList.find(m => m.exam === 'Final');
  
  if (exam2) {
    const scores = Object.values(exam2.subjects);
    failedCount = scores.filter(s => s < 35).length;
    lastExamAvg = scores.reduce((a,b)=>a+b,0) / scores.length;
  }
  if (exam1) {
    const scores = Object.values(exam1.subjects);
    prevExamAvg = scores.reduce((a,b)=>a+b,0) / scores.length;
  }

  if (failedCount >= 3) failScore = 1;
  else failScore = failedCount / 3;

  if (exam1 && exam2 && prevExamAvg > lastExamAvg) {
    const drop = prevExamAvg - lastExamAvg;
    declineScore = Math.min(drop / 20, 1); 
  }

  // Demographic & Context Scores (0 or 1)
  const finScore = student.financialDifficulty ? 1 : 0;
  const distScore = (student.distanceFromSchool > 3 && !student.transportAvailable) ? 1 : 0;
  const edScore = student.guardianEducation === 'None' ? 1 : (student.guardianEducation === 'Primary' ? 0.5 : 0);
  const healthScore = student.healthConcern ? 1 : 0;
  const famScore = student.familyResponsibility ? 1 : 0;
  const expectedAge = 5 + parseInt(student.class);
  const ageScore = (student.age - expectedAge) > 1 ? 1 : 0;

  // Total Score
  const rawScore = (
    attScore * weights.attendance +
    consAbsScore * weights.consecutiveAbs +
    failScore * weights.failedSubjects +
    declineScore * weights.marksDecline +
    finScore * weights.financial +
    distScore * weights.distanceTransport +
    edScore * weights.guardianEd +
    healthScore * weights.health +
    famScore * weights.familyResp +
    ageScore * weights.ageMismatch
  );

  const finalScore = Math.min(Math.round(rawScore), 100);
  let category = 'Low';
  if (finalScore >= 67) category = 'High';
  else if (finalScore >= 34) category = 'Medium';

  // Build plain English factors
  let factors = [];
  if (attScore > 0.3) factors.push({ text: `Attendance is ${attPercentage.toFixed(0)}% (below 75%)`, points: Math.round(attScore * weights.attendance), key: 'attendance' });
  if (consAbsScore > 0.3) factors.push({ text: `Consecutive absences (${maxConsecutiveAbs} days)`, points: Math.round(consAbsScore * weights.consecutiveAbs), key: 'consAbs' });
  if (failScore > 0) factors.push({ text: `Failed ${failedCount} subject(s)`, points: Math.round(failScore * weights.failedSubjects), key: 'failed' });
  if (finScore > 0) factors.push({ text: 'Financial difficulties reported', points: weights.financial, key: 'financial' });
  if (distScore > 0) factors.push({ text: `Lives ${student.distanceFromSchool}km away with no transport`, points: weights.distanceTransport, key: 'transport' });
  if (declineScore > 0.2) factors.push({ text: 'Significant decline in marks', points: Math.round(declineScore * weights.marksDecline), key: 'decline' });

  factors.sort((a, b) => b.points - a.points);
  
  // Suggestions
  const suggestions = [];
  if (factors.find(f => f.key === 'attendance' || f.key === 'consAbs')) suggestions.push('Schedule Parent-Teacher meeting regarding attendance.');
  if (factors.find(f => f.key === 'failed' || f.key === 'decline')) suggestions.push('Arrange remedial classes for failed/weak subjects.');
  if (factors.find(f => f.key === 'financial')) suggestions.push('Evaluate for state scholarship schemes.');
  if (factors.find(f => f.key === 'transport')) suggestions.push('Link with local transport subsidies or carpools.');

  return { score: finalScore, category, factors: factors.slice(0, 4), suggestions };
};

// --- DATA GENERATOR ---
const generateDemoData = () => {
  const firstNames = ['Aarav', 'Aditi', 'Arjun', 'Bhavya', 'Chetan', 'Deepa', 'Darshan', 'Gowri', 'Harsha', 'Ishika', 'Karthik', 'Kavya', 'Manjunath', 'Meghana', 'Naveen', 'Nandini', 'Praveen', 'Pooja', 'Rahul', 'Rashmi', 'Sachin', 'Sneha', 'Tarun', 'Tejaswini', 'Varun', 'Vidya', 'Yash', 'Yashaswini'];
  const lastNames = ['Gowda', 'Patil', 'Kumar', 'Reddy', 'Hegde', 'Joshi', 'Shetty', 'Nayak', 'Rao', 'Bhat'];
  
  let students = [];
  let attendance = [];
  let marks = [];
  let interventions = [];
  
  for (let i = 1; i <= 120; i++) {
    const isHigh = i <= 15; // ~13%
    const isMed = i > 15 && i <= 42; // ~22%
    
    const cls = Math.floor(Math.random() * 10) + 1;
    const age = cls + 5 + (isHigh && Math.random() > 0.5 ? 2 : 0); // Some age mismatch
    const gender = Math.random() > 0.5 ? 'Male' : 'Female';
    
    const stu = {
      id: `STU${1000 + i}`,
      name: `${firstNames[Math.floor(Math.random()*firstNames.length)]} ${lastNames[Math.floor(Math.random()*lastNames.length)]}`,
      age,
      gender,
      class: cls.toString(),
      section: Math.random() > 0.5 ? 'A' : 'B',
      district: DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)],
      guardianName: `${firstNames[Math.floor(Math.random()*firstNames.length)]} ${lastNames[Math.floor(Math.random()*lastNames.length)]}`,
      phone: `+91 ${Math.floor(Math.random() * 900) + 100} XX XXX`,
      guardianEducation: isHigh ? (Math.random() > 0.5 ? 'None' : 'Primary') : 'Secondary',
      financialDifficulty: isHigh || (isMed && Math.random() > 0.5),
      distanceFromSchool: isHigh ? Math.floor(Math.random() * 8) + 3 : Math.floor(Math.random() * 4) + 1,
      transportAvailable: !isHigh,
      healthConcern: isHigh && Math.random() > 0.7,
      familyResponsibility: isHigh && Math.random() > 0.5,
      consent: true,
      status: (isHigh && Math.random() > 0.8) ? 'Dropped Out' : 'Active'
    };
    students.push(stu);

    // Generate Attendance (Last 90 days)
    let attDrop = isHigh ? 0.5 : (isMed ? 0.75 : 0.95);
    for(let d=0; d<90; d++) {
      attendance.push({
        studentId: stu.id,
        date: new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: Math.random() < attDrop ? 'Present' : 'Absent'
      });
    }

    // Generate Marks
    const genMarks = (isBad) => ({
      Math: Math.floor(Math.random() * (isBad ? 40 : 60)) + (isBad ? 10 : 40),
      Science: Math.floor(Math.random() * (isBad ? 40 : 60)) + (isBad ? 10 : 40),
      English: Math.floor(Math.random() * (isBad ? 40 : 60)) + (isBad ? 10 : 40),
      Kannada: Math.floor(Math.random() * (isBad ? 40 : 60)) + (isBad ? 10 : 40),
      Social: Math.floor(Math.random() * (isBad ? 40 : 60)) + (isBad ? 10 : 40),
    });
    marks.push({ studentId: stu.id, exam: 'Midterm', subjects: genMarks(isHigh && Math.random() > 0.3) });
    marks.push({ studentId: stu.id, exam: 'Final', subjects: genMarks(isHigh) });

    // Seed interventions for some
    if (isHigh || isMed) {
      interventions.push({
        id: `INV${i}`,
        studentId: stu.id,
        type: 'Parent-Teacher Meeting',
        date: new Date(Date.now() - Math.floor(Math.random()*30) * 86400000).toISOString().split('T')[0],
        status: Math.random() > 0.5 ? 'Done' : 'In Progress',
        outcome: 'Pending'
      });
    }
  }
  
  return { students, attendance, marks, interventions };
};

// --- SHARED COMPONENTS ---
const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-6 ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false }) => {
  const base = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 shadow-sm",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    outline: "border border-slate-200 text-slate-700 hover:bg-slate-50",
    danger: "bg-red-50 text-red-600 hover:bg-red-100"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Badge = ({ risk }) => {
  const colors = {
    Low: 'bg-green-100 text-green-700 border-green-200',
    Medium: 'bg-amber-100 text-amber-700 border-amber-200',
    High: 'bg-red-100 text-red-700 border-red-200'
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[risk] || 'bg-slate-100 text-slate-700'}`}>
      {risk} Risk
    </span>
  );
};

// --- APP CONTEXT ---
const AppContext = createContext();

// --- MAIN COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null); // { role: 'admin'|'teacher', classes: [] }
  const [currentPage, setCurrentPage] = useState('landing');
  const [lang, setLang] = useState('en');
  const [data, setData] = useState({ students: [], attendance: [], marks: [], interventions: [] });
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Initialization
  useEffect(() => {
    const savedData = localStorage.getItem('studentSignalsData');
    if (savedData) {
      setData(JSON.parse(savedData));
    } else {
      const generated = generateDemoData();
      setData(generated);
      localStorage.setItem('studentSignalsData', JSON.stringify(generated));
    }
  }, []);

  const saveData = (newData) => {
    setData(newData);
    localStorage.setItem('studentSignalsData', JSON.stringify(newData));
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const t = (key) => TRANSLATIONS[lang][key] || key;

  // Process data with risk engine
  const processedStudents = useMemo(() => {
    if (!data.students) return [];
    let filtered = data.students;
    if (user?.role === 'teacher') {
      filtered = data.students.filter(s => user.classes.includes(s.class));
    }
    return filtered.map(student => {
      const studentAtt = data.attendance.filter(a => a.studentId === student.id);
      const studentMarks = data.marks.filter(m => m.studentId === student.id);
      const risk = calculateRisk(student, studentAtt, studentMarks);
      return { ...student, riskInfo: risk };
    });
  }, [data, user]);

  const login = (role) => {
    setUser(role === 'admin' ? { role: 'admin' } : { role: 'teacher', classes: ['8', '9', '10'] });
    setCurrentPage('dashboard');
  };

  const logout = () => {
    setUser(null);
    setCurrentPage('landing');
  };

  // Views
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <header className="bg-white border-b border-slate-200 py-4 px-6 md:px-12 flex justify-between items-center sticky top-0 z-10">
          <div className="flex items-center gap-2 text-teal-700 font-bold text-2xl">
            <Activity className="h-8 w-8" />
            Student Signals
          </div>
          <div className="flex gap-4">
            <Button onClick={() => login('teacher')} variant="outline">Login as Teacher</Button>
            <Button onClick={() => login('admin')}>Login as Admin</Button>
          </div>
        </header>
        
        <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-12">
          <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight mb-6">
                Smart School Dropout <span className="text-teal-700">Prevention</span> System
              </h1>
              <p className="text-lg text-slate-600 mb-8">
                Addressing the 14.1% secondary dropout rate. Identify students at risk early, manage interventions, and ensure every child stays in school. Built for Karnataka schools.
              </p>
              <div className="flex gap-4">
                 <Button onClick={() => login('admin')} className="text-lg px-6 py-3 rounded-xl">Get Started</Button>
              </div>
            </div>
            <div className="relative">
               <div className="absolute inset-0 bg-gradient-to-tr from-teal-100 to-amber-50 rounded-full blur-3xl opacity-50"></div>
               <img src="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&q=80&w=800" alt="Students studying" className="relative rounded-2xl shadow-xl border-4 border-white object-cover aspect-video" />
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-6 mb-12">
            {[
              { icon: Activity, title: 'Analyze Data', desc: 'Ingests attendance, marks, and socio-economic data.' },
              { icon: AlertTriangle, title: 'Early Warning', desc: 'AI-driven risk scoring flags vulnerable students.' },
              { icon: Users, title: 'Intervene', desc: 'Suggests and tracks targeted support actions.' },
              { icon: TrendingUp, title: 'Retain', desc: 'Monitors progress to ensure successful retention.' }
            ].map((s, i) => (
              <Card key={i} className="text-center hover:-translate-y-1 transition-transform">
                <div className="bg-teal-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-teal-700">
                  <s.icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.desc}</p>
              </Card>
            ))}
          </div>
        </main>
        
        <footer className="bg-slate-900 text-slate-400 py-6 text-center text-sm border-t border-slate-800">
          <p className="max-w-3xl mx-auto flex items-center justify-center gap-2">
            <Info className="w-4 h-4" /> Ethics Note: Risk alerts support human review and must never be used to deny education or discriminate.
          </p>
        </footer>
      </div>
    );
  }

  const contextValue = { data, setData: saveData, processedStudents, user, lang, t, showToast, setCurrentPage };

  const navItems = [
    { id: 'dashboard', icon: Activity, label: t('dashboard') },
    { id: 'students', icon: Users, label: t('students') },
    { id: 'earlyWarning', icon: AlertTriangle, label: t('earlyWarning') },
    { id: 'attendance', icon: CheckCircle, label: t('attendance') },
    { id: 'marks', icon: BookOpen, label: t('marks') },
    { id: 'interventions', icon: Heart, label: t('interventions') },
    { id: 'counselling', icon: Phone, label: t('counselling') },
    { id: 'notifications', icon: FileText, label: t('notifications') },
    { id: 'scholarships', icon: Book, label: t('scholarships') },
    { id: 'geo', icon: MapIcon, label: t('geo') },
    { id: 'reenrolment', icon: UserPlus, label: t('reenrolment') },
    { id: 'settings', icon: Settings, label: t('settings') },
  ];

  return (
    <AppContext.Provider value={contextValue}>
      <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ease-in-out print:hidden ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col`}>
          <div className="p-4 flex justify-between items-center border-b border-slate-100">
            <div className="flex items-center gap-2 text-teal-700 font-bold text-xl">
              <Activity className="h-6 w-6" /> Signals
            </div>
            <button className="md:hidden text-slate-500" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => { setCurrentPage(item.id); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  currentPage === item.id || (currentPage === 'studentProfile' && item.id === 'students')
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 sm:px-6 print:hidden">
            <div className="flex items-center gap-4">
              <button className="md:hidden text-slate-500" onClick={() => setSidebarOpen(true)}>
                <Menu className="w-6 h-6" />
              </button>
              <div className="bg-amber-100 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Demo Data Mode
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600 capitalize bg-slate-100 px-3 py-1 rounded-lg">
                Role: {user.role} {user.role === 'teacher' && '(Classes 8-10)'}
              </span>
              <button onClick={logout} className="text-slate-500 hover:text-slate-700">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </header>
          
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative custom-scrollbar print:p-0">
             {currentPage === 'dashboard' && <DashboardPage />}
             {currentPage === 'students' && <StudentsPage />}
             {currentPage === 'studentProfile' && <StudentProfilePage />}
             {currentPage === 'attendance' && <AttendancePage />}
             {currentPage === 'marks' && <MarksPage />}
             {currentPage === 'earlyWarning' && <EarlyWarningPage />}
             {currentPage === 'interventions' && <InterventionsPage />}
             {currentPage === 'counselling' && <CounsellingPage />}
             {currentPage === 'notifications' && <NotificationsPage />}
             {currentPage === 'scholarships' && <ScholarshipsPage />}
             {currentPage === 'geo' && <GeographicalPage />}
             {currentPage === 'reenrolment' && <ReenrolmentPage />}
             {currentPage === 'settings' && <SettingsPage />}
          </main>
          
          <footer className="bg-white border-t border-slate-200 p-3 text-center text-xs text-slate-500 print:hidden">
            <Info className="w-3 h-3 inline mr-1" /> Risk alerts support human review and must never be used to deny education.
          </footer>
        </div>

        {/* Global Toast */}
        {toast && (
          <div className="fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-bounce">
            <CheckCircle className="w-4 h-4 text-green-400" />
            {toast}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}

// --- PAGE COMPONENTS ---

function DashboardPage() {
  const { processedStudents, data } = useContext(AppContext);
  
  const stats = useMemo(() => {
    const total = processedStudents.length;
    const highRisk = processedStudents.filter(s => s.riskInfo.category === 'High').length;
    const medRisk = processedStudents.filter(s => s.riskInfo.category === 'Medium').length;
    
    // Attendance Concern (avg below 75%)
    let attConcerns = 0;
    processedStudents.forEach(s => {
      const att = data.attendance.filter(a => a.studentId === s.id);
      const present = att.filter(a => a.status === 'Present').length;
      if (att.length && (present/att.length) < 0.75) attConcerns++;
    });

    const retained = data.interventions.filter(i => i.outcome === 'Improved').length;
    
    return { total, highRisk, medRisk, attConcerns, retained };
  }, [processedStudents, data]);

  const donutData = [
    { name: 'Low Risk', value: stats.total - stats.highRisk - stats.medRisk, color: COLORS.low },
    { name: 'Medium Risk', value: stats.medRisk, color: COLORS.medium },
    { name: 'High Risk', value: stats.highRisk, color: COLORS.high }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <Button variant="outline" className="gap-2">
          <Download className="w-4 h-4" /> Download Report (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Enrolled" value={stats.total} icon={Users} color="text-teal-600" bg="bg-teal-50" />
        <StatCard title="High-Risk Students" value={stats.highRisk} icon={AlertTriangle} color="text-red-600" bg="bg-red-50" trend="+2%" />
        <StatCard title="Attendance Concerns" value={stats.attConcerns} icon={Activity} color="text-amber-600" bg="bg-amber-50" />
        <StatCard title="Retained (Intervention)" value={stats.retained} icon={CheckCircle} color="text-green-600" bg="bg-green-50" trend="+5%" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 flex flex-col">
          <h3 className="font-semibold text-slate-800 mb-4">Risk Distribution by Class</h3>
          <div className="h-64 flex-1">
             <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[1,2,3,4,5,6,7,8,9,10].map(c => ({
                name: `Cls ${c}`, 
                High: processedStudents.filter(s=>s.class==c && s.riskInfo.category=='High').length,
                Medium: processedStudents.filter(s=>s.class==c && s.riskInfo.category=='Medium').length
              }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <RechartsTooltip cursor={{fill: '#f1f5f9'}} />
                <Legend />
                <Bar dataKey="High" stackId="a" fill={COLORS.high} radius={[0,0,4,4]} />
                <Bar dataKey="Medium" stackId="a" fill={COLORS.medium} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        
        <Card className="flex flex-col">
          <h3 className="font-semibold text-slate-800 mb-4">Overall Risk Spread</h3>
          <div className="h-64 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <RechartsTooltip />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, bg, trend }) {
  return (
    <Card className="flex items-center p-5">
      <div className={`${bg} ${color} p-3 rounded-xl mr-4`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <div className="flex items-end gap-2">
          <h4 className="text-2xl font-bold text-slate-900">{value}</h4>
          {trend && <span className="text-xs font-medium text-green-600 mb-1">{trend}</span>}
        </div>
      </div>
    </Card>
  );
}

function StudentsPage() {
  const { processedStudents, setCurrentPage, user } = useContext(AppContext);
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('All');
  
  const filtered = processedStudents.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.id.toLowerCase().includes(search.toLowerCase());
    const matchClass = filterClass === 'All' || s.class === filterClass;
    return matchSearch && matchClass;
  });

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Student Directory</h1>
        <Button className="gap-2"><Plus className="w-4 h-4"/> Add Student</Button>
      </div>
      
      <Card className="flex-1 flex flex-col p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" placeholder="Search by name or ID..." 
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select 
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none"
            value={filterClass} onChange={e => setFilterClass(e.target.value)}
          >
            <option value="All">All Classes</option>
            {[...Array(10)].map((_,i) => {
               if(user.role === 'teacher' && !user.classes.includes(String(i+1))) return null;
               return <option key={i+1} value={i+1}>Class {i+1}</option>;
            })}
          </select>
        </div>
        
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 bg-slate-50 uppercase border-b border-slate-100">
              <tr>
                <th className="px-6 py-3">ID</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Class</th>
                <th className="px-6 py-3">District</th>
                <th className="px-6 py-3">Risk Level</th>
                <th className="px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{s.id}</td>
                  <td className="px-6 py-4">{s.name}</td>
                  <td className="px-6 py-4">{s.class} '{s.section}'</td>
                  <td className="px-6 py-4">{s.district}</td>
                  <td className="px-6 py-4"><Badge risk={s.riskInfo.category} /></td>
                  <td className="px-6 py-4">
                    <Button variant="outline" className="py-1 px-3 text-xs" onClick={() => {
                      localStorage.setItem('currentProfileId', s.id);
                      setCurrentPage('studentProfile');
                    }}>View</Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="6" className="text-center py-8 text-slate-500">No students found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StudentProfilePage() {
  const { processedStudents, setCurrentPage, data } = useContext(AppContext);
  const id = localStorage.getItem('currentProfileId');
  const student = processedStudents.find(s => s.id === id);
  
  // Simulator State
  const [simAtt, setSimAtt] = useState(80);
  const [simFail, setSimFail] = useState(0);

  if (!student) return <div>Student not found. <Button onClick={()=>setCurrentPage('students')}>Back</Button></div>;

  const simRisk = useMemo(() => {
    // build a fake attendance array to match the slider
    const total = 100;
    const present = simAtt;
    const fakeAtt = Array(total).fill(0).map((_,i) => ({ status: i < present ? 'Present' : 'Absent'}));
    
    // build a fake marks array to match slider
    const fakeMarks = [{ exam: 'Final', subjects: {} }];
    for(let i=0; i<5; i++) {
       fakeMarks[0].subjects[`Sub${i}`] = i < simFail ? 20 : 60; // 20 is fail, 60 is pass
    }

    return calculateRisk(student, fakeAtt, fakeMarks);
  }, [simAtt, simFail, student]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center print:hidden">
        <Button variant="outline" onClick={() => setCurrentPage('students')}>&larr; Back</Button>
        <Button onClick={() => window.print()} className="gap-2"><Printer className="w-4 h-4"/> Print Report</Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Profile Summary */}
        <Card className="col-span-3 lg:col-span-1 border-t-4 border-t-teal-600">
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-xl font-bold">{student.name}</h2>
             <Badge risk={student.riskInfo.category} />
          </div>
          <div className="space-y-3 text-sm">
            <p><span className="text-slate-500 w-24 inline-block">ID:</span> font-medium {student.id}</p>
            <p><span className="text-slate-500 w-24 inline-block">Class:</span> {student.class} '{student.section}'</p>
            <p><span className="text-slate-500 w-24 inline-block">Age/Gender:</span> {student.age}, {student.gender}</p>
            <p><span className="text-slate-500 w-24 inline-block">District:</span> {student.district}</p>
            <hr className="my-2" />
            <p><span className="text-slate-500 w-24 inline-block">Guardian:</span> {student.guardianName}</p>
            <p><span className="text-slate-500 w-24 inline-block">Phone:</span> {student.phone}</p>
            <p><span className="text-slate-500 w-24 inline-block">Distance:</span> {student.distanceFromSchool} km ({student.transportAvailable ? 'Transport' : 'No Transport'})</p>
            <p><span className="text-slate-500 w-24 inline-block">Financial:</span> {student.financialDifficulty ? 'Concern' : 'Ok'}</p>
          </div>
          
          <div className="mt-6 bg-slate-50 rounded-xl p-4 text-center">
             <div className="text-4xl font-extrabold text-slate-900 mb-1">{student.riskInfo.score}</div>
             <div className="text-xs text-slate-500">Risk Score (0-100)</div>
          </div>
        </Card>

        {/* Why this alert & Simulator */}
        <div className="col-span-3 lg:col-span-2 space-y-6">
          <Card>
            <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500"/> Why this alert? (Top Factors)
            </h3>
            {student.riskInfo.factors.length > 0 ? (
              <ul className="space-y-3">
                {student.riskInfo.factors.map((f, i) => (
                  <li key={i} className="flex justify-between items-center bg-slate-50 px-4 py-2 rounded-lg text-sm">
                    <span>{f.text}</span>
                    <span className="font-mono text-xs bg-white border border-slate-200 px-2 py-1 rounded">+{f.points} pts</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No major risk factors detected.</p>
            )}
            
            {student.riskInfo.suggestions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Suggested Interventions:</h4>
                <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
                  {student.riskInfo.suggestions.map((s,i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </Card>

          <Card className="print:hidden">
            <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-600"/> What-If Simulator
            </h3>
            <p className="text-xs text-slate-500 mb-4">Adjust values to see how targeted improvements affect the risk score.</p>
            
            <div className="flex flex-col sm:flex-row gap-8 items-center">
              <div className="flex-1 space-y-4 w-full">
                <div>
                  <label className="text-sm text-slate-700 flex justify-between">
                    Attendance % <span>{simAtt}%</span>
                  </label>
                  <input type="range" min="0" max="100" value={simAtt} onChange={e=>setSimAtt(parseInt(e.target.value))} className="w-full accent-teal-600" />
                </div>
                <div>
                  <label className="text-sm text-slate-700 flex justify-between">
                    Failed Subjects <span>{simFail}</span>
                  </label>
                  <input type="range" min="0" max="5" value={simFail} onChange={e=>setSimFail(parseInt(e.target.value))} className="w-full accent-teal-600" />
                </div>
              </div>
              <div className="w-32 h-32 rounded-full border-8 border-slate-100 flex items-center justify-center flex-col relative">
                 <div className="text-2xl font-bold">{simRisk.score}</div>
                 <div className="text-[10px] text-slate-500 uppercase">Simulated</div>
                 {/* Decorative semi-circle visual */}
                 <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
                    <circle cx="64" cy="64" r="56" fill="transparent" stroke={COLORS[simRisk.category.toLowerCase()]} strokeWidth="8" 
                      strokeDasharray={`${(simRisk.score/100) * 351} 351`} />
                 </svg>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AttendancePage() {
  const { processedStudents, showToast, user } = useContext(AppContext);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [cls, setCls] = useState(user.role === 'teacher' ? user.classes[0] : '8');

  const filteredStudents = processedStudents.filter(s => s.class === cls);
  // Fake local state just for UI demonstration of marking attendance
  const [attMap, setAttMap] = useState({});

  useEffect(() => {
    // reset mock state on class/date change
    const initial = {};
    filteredStudents.forEach(s => initial[s.id] = 'Present');
    setAttMap(initial);
  }, [cls, date, filteredStudents.length]);

  const handleSave = () => {
    showToast(`Attendance saved for Class ${cls} on ${date}`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Daily Attendance Tracker</h1>
      
      <Card>
        <div className="flex flex-wrap gap-4 items-end mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
            <select className="border border-slate-300 rounded-lg px-3 py-2" value={cls} onChange={e=>setCls(e.target.value)}>
              {[...Array(10)].map((_,i) => {
                 if(user.role === 'teacher' && !user.classes.includes(String(i+1))) return null;
                 return <option key={i+1} value={i+1}>Class {i+1}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2" value={date} onChange={e=>setDate(e.target.value)} />
          </div>
          <Button onClick={handleSave} className="ml-auto">Save Attendance</Button>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Roll / ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map(s => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{s.id}</td>
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex rounded-lg shadow-sm">
                      <button 
                        onClick={() => setAttMap({...attMap, [s.id]: 'Present'})}
                        className={`px-4 py-1.5 text-xs font-medium rounded-l-lg border ${attMap[s.id]==='Present' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                      >Present</button>
                      <button 
                        onClick={() => setAttMap({...attMap, [s.id]: 'Absent'})}
                        className={`px-4 py-1.5 text-xs font-medium rounded-r-lg border-t border-b border-r ${attMap[s.id]==='Absent' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                      >Absent</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-slate-500">No students found for this class.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function EarlyWarningPage() {
  const { processedStudents, setCurrentPage } = useContext(AppContext);
  
  const highRisk = [...processedStudents]
    .filter(s => s.riskInfo.category === 'High')
    .sort((a, b) => b.riskInfo.score - a.riskInfo.score);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 text-red-600 flex items-center gap-2">
          <AlertTriangle /> Early Warning System
        </h1>
        <p className="text-slate-500 text-sm mt-1">Students prioritized for immediate intervention based on risk score.</p>
      </div>

      <div className="grid gap-4">
        {highRisk.map((s, index) => (
          <Card key={s.id} className="border-l-4 border-l-red-500 flex flex-col md:flex-row gap-6 md:items-center justify-between">
            <div className="flex gap-4 items-center">
              <div className="bg-red-100 text-red-700 font-bold text-xl rounded-full w-12 h-12 flex items-center justify-center shrink-0">
                {s.riskInfo.score}
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg">{s.name} <span className="text-sm font-normal text-slate-500 ml-2">Class {s.class}'{s.section}' | {s.district}</span></h3>
                <p className="text-sm text-slate-600 mt-1">
                  <strong>Top Factor:</strong> {s.riskInfo.factors[0]?.text || 'Complex multiple factors'}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
               <Button variant="outline" onClick={() => {
                 localStorage.setItem('currentProfileId', s.id);
                 setCurrentPage('studentProfile');
               }}>View Profile</Button>
               <Button onClick={() => setCurrentPage('interventions')} className="bg-red-600 hover:bg-red-700 text-white">Log Intervention</Button>
            </div>
          </Card>
        ))}
        {highRisk.length === 0 && (
          <Card className="text-center py-12">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <p className="text-slate-500 text-lg">No high-risk students currently identified in your scope.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function InterventionsPage() {
  const { data, processedStudents } = useContext(AppContext);
  const interventions = data.interventions.map(inv => {
    const student = processedStudents.find(s => s.id === inv.studentId);
    return { ...inv, studentName: student ? student.name : 'Unknown' };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Intervention Tracker</h1>
        <Button className="gap-2"><Plus className="w-4 h-4"/> New Action</Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {['Planned', 'In Progress', 'Done'].map(status => (
          <div key={status} className="bg-slate-100 rounded-xl p-4 min-h-[500px]">
            <h3 className="font-bold text-slate-700 mb-4 uppercase text-xs tracking-wider border-b border-slate-200 pb-2">{status}</h3>
            <div className="space-y-3">
              {interventions.filter(i => (status === 'Planned' && i.status === 'Planned') || (status === 'In Progress' && i.status === 'In Progress') || (status === 'Done' && i.status === 'Done')).map(inv => (
                <Card key={inv.id} className="p-4 cursor-pointer hover:shadow-md transition-shadow">
                  <div className="text-xs text-slate-500 mb-1">{inv.date}</div>
                  <div className="font-semibold text-sm mb-1">{inv.type}</div>
                  <div className="text-xs text-slate-600">Student: {inv.studentName}</div>
                  {status === 'Done' && (
                    <div className={`mt-2 text-xs font-medium ${inv.outcome === 'Improved' ? 'text-green-600' : 'text-amber-600'}`}>
                      Outcome: {inv.outcome}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsPage() {
  const { showToast } = useContext(AppContext);
  const [lang, setLang] = useState('en');
  
  const templates = {
    en: {
      attendance: "Dear Parent, your child's attendance is low. Please contact the school to ensure their progress is not affected.",
      meeting: "Dear Parent, we invite you to a support meeting at the school on [Date] to discuss your child's performance."
    },
    kn: {
      attendance: "ಆತ್ಮೀಯ ಪಾಲಕರೆ, ನಿಮ್ಮ ಮಗುವಿನ ಹಾಜರಾತಿ ಕಡಿಮೆಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      meeting: "ಆತ್ಮೀಯ ಪಾಲಕರೆ, ನಿಮ್ಮ ಮಗುವಿನ ಪ್ರಗತಿಯ ಕುರಿತು ಚರ್ಚಿಸಲು [Date] ರಂದು ಶಾಲೆಗೆ ಭೇಟಿ ನೀಡಲು ನಿಮ್ಮನ್ನು ಆಹ್ವಾನಿಸುತ್ತಿದ್ದೇವೆ."
    },
    hi: {
      attendance: "प्रिय अभिभावक, आपके बच्चे की उपस्थिति कम है। कृपया स्कूल से संपर्क करें।",
      meeting: "प्रिय अभिभावक, हम आपको [Date] को आपके बच्चे के प्रदर्शन पर चर्चा करने के लिए स्कूल में आमंत्रित करते हैं।"
    }
  };

  const copyToClipboard = () => {
    showToast("Message copied to clipboard!");
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Parent Notifications</h1>
      <p className="text-sm text-slate-500">Use these templates to message parents via WhatsApp or SMS. (No real SMS is sent from this demo).</p>

      <div className="flex gap-2 mb-4">
        {['en', 'kn', 'hi'].map(l => (
          <button 
            key={l} onClick={()=>setLang(l)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium ${lang===l ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-700'}`}
          >
            {l === 'en' ? 'English' : (l === 'kn' ? 'ಕನ್ನಡ' : 'हिन्दी')}
          </button>
        ))}
      </div>

      <div className="grid gap-6">
        <Card>
          <h3 className="font-semibold mb-2 text-slate-800">Low Attendance Alert</h3>
          <textarea className="w-full border border-slate-200 rounded-lg p-3 text-sm min-h-[100px] bg-slate-50" readOnly value={templates[lang].attendance} />
          <div className="mt-4 flex justify-end gap-3">
             <Button variant="outline" className="gap-2" onClick={copyToClipboard}><Copy className="w-4 h-4"/> Copy Text</Button>
             <Button onClick={()=>showToast("Logged in communication history.")}>Mark as Sent</Button>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-2 text-slate-800">Support Meeting Invitation</h3>
          <textarea className="w-full border border-slate-200 rounded-lg p-3 text-sm min-h-[100px] bg-slate-50" readOnly value={templates[lang].meeting} />
          <div className="mt-4 flex justify-end gap-3">
             <Button variant="outline" className="gap-2" onClick={copyToClipboard}><Copy className="w-4 h-4"/> Copy Text</Button>
             <Button onClick={()=>showToast("Logged in communication history.")}>Mark as Sent</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ScholarshipsPage() {
  const { processedStudents } = useContext(AppContext);
  const eligible = processedStudents.filter(s => s.financialDifficulty && s.riskInfo.category !== 'Low');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Scholarship Linkage</h1>
      <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm flex gap-3">
         <Info className="w-5 h-5 shrink-0" />
         <div>
           <strong>Disclaimer:</strong> The schemes listed here are examples. Verify active status with official Karnataka Government portals (e.g., SSP Portal).
         </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-teal-700 to-teal-900 text-white border-0">
          <h3 className="text-xl font-bold mb-2">Pre-Matric Scholarship</h3>
          <p className="text-teal-100 text-sm mb-4">For minority/OBC students classes 1 to 10 with annual family income below ₹1,00,000.</p>
          <Button className="bg-white text-teal-900 hover:bg-slate-100 w-full">View Details</Button>
        </Card>
        <Card className="bg-gradient-to-br from-amber-600 to-amber-800 text-white border-0">
          <h3 className="text-xl font-bold mb-2">RTE Provisions Support</h3>
          <p className="text-amber-100 text-sm mb-4">Support for uniforms, books, and transport for disadvantaged groups.</p>
          <Button className="bg-white text-amber-900 hover:bg-slate-100 w-full">View Details</Button>
        </Card>
      </div>

      <h2 className="text-lg font-bold mt-8">Auto-Flagged Eligible Students (Demo)</h2>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Risk Level</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {eligible.slice(0,5).map(s => (
              <tr key={s.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3">{s.class}</td>
                <td className="px-4 py-3"><Badge risk={s.riskInfo.category} /></td>
                <td className="px-4 py-3"><Button variant="outline" className="text-xs py-1 h-auto">Start Application</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function GeographicalPage() {
  const { processedStudents } = useContext(AppContext);
  
  const geoData = DISTRICTS.map(d => {
    const studentsInDist = processedStudents.filter(s => s.district === d);
    const high = studentsInDist.filter(s => s.riskInfo.category === 'High').length;
    const med = studentsInDist.filter(s => s.riskInfo.category === 'Medium').length;
    return { name: d, HighRisk: high, MediumRisk: med, Total: studentsInDist.length };
  }).sort((a,b) => b.HighRisk - a.HighRisk);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Geographical Analysis</h1>
      
      <Card className="flex flex-col h-[400px]">
        <h3 className="font-semibold text-slate-800 mb-4">Risk Distribution by District</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={geoData} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
            <XAxis type="number" />
            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} />
            <RechartsTooltip />
            <Legend />
            <Bar dataKey="HighRisk" name="High Risk" stackId="a" fill={COLORS.high} />
            <Bar dataKey="MediumRisk" name="Medium Risk" stackId="a" fill={COLORS.medium} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// Fallback empty components for pages that share logic
function MarksPage() {
  return (
    <div className="space-y-6 text-center py-20">
      <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-slate-700">Marks Entry</h1>
      <p className="text-slate-500 max-w-md mx-auto">This module allows subject teachers to input formative and summative assessment scores.</p>
      <Button variant="outline">Download Excel Template</Button>
    </div>
  );
}

function CounsellingPage() {
  return (
    <div className="space-y-6 text-center py-20">
      <Phone className="w-16 h-16 text-slate-300 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-slate-700">Counselling Tracker</h1>
      <p className="text-slate-500 max-w-md mx-auto">Track psychosocial support sessions for high-risk students and schedule follow-ups.</p>
    </div>
  );
}

function ReenrolmentPage() {
  return (
    <div className="space-y-6 text-center py-20">
      <UserPlus className="w-16 h-16 text-slate-300 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-slate-700">Re-enrolment Tracking</h1>
      <p className="text-slate-500 max-w-md mx-auto">Monitor students who had dropped out and track their successful reintegration into the system.</p>
    </div>
  );
}

function SettingsPage() {
  const { showToast } = useContext(AppContext);
  const handleReset = () => {
    localStorage.removeItem('studentSignalsData');
    window.location.reload();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Settings & About</h1>
      
      <Card>
        <h3 className="font-semibold mb-4 text-slate-800 border-b pb-2">System Controls</h3>
        <Button onClick={handleReset} variant="danger">Reset Demo Data</Button>
        <p className="text-xs text-slate-500 mt-2">This will clear local storage and regenerate the 120 demo students.</p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 text-slate-800 border-b pb-2">Ethics & Privacy Compliance</h3>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-2">
           <li>All data is stored locally in your browser. No data is sent to external servers.</li>
           <li>Risk scores are algorithmic indicators based on UDISE+ recognized factors, not deterministic verdicts.</li>
           <li>Consent records must be physically maintained as per state education board guidelines.</li>
        </ul>
      </Card>
    </div>
  );
}