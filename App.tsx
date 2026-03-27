import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/Header';
import { Planner } from './components/Planner';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { AuthProvider, useAuth } from './context/AuthContext';

const Home: React.FC = () => {
  return (
    <main className="flex-grow container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-16 text-center space-y-5">
         <div className="badge mx-auto animate-fade-in-up scale-hover">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            AI-Powered
         </div>
         <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight animate-fade-in-up delay-100" style={{animationFillMode: 'both'}}>
            Discover local gems <br/>
            <span className="gradient-text">tailored to you</span>
         </h1>
         <p className="text-slate-500 text-lg max-w-xl mx-auto leading-relaxed animate-fade-in-up delay-200" style={{animationFillMode: 'both'}}>
            Smart trip recommendations based on your time, mood, and travel preferences.
         </p>
      </div>

      <Planner />
    </main>
  );
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route 
        path="/signin" 
        element={isAuthenticated ? <Navigate to="/" replace /> : <SignIn />} 
      />
      <Route 
        path="/signup" 
        element={isAuthenticated ? <Navigate to="/" replace /> : <SignUp />} 
      />
      <Route 
        path="/" 
        element={isAuthenticated ? <Home /> : <Navigate to="/signin" replace />} 
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
      <AuthProvider>
        <Router>
          <div className="min-h-screen flex flex-col bg-[#fafbfc]">
            <Header />
            
            <AppRoutes />

            <footer className="py-10 text-center border-t border-slate-200 bg-white animate-fade-in">
              <p className="text-slate-500 text-sm hover:text-indigo-600 transition-colors cursor-default">TripRad &copy; {new Date().getFullYear()}</p>
              <p className="mt-1 text-xs text-slate-400 animate-float">Powered by Gemini AI ✨</p>
            </footer>
          </div>
        </Router>
      </AuthProvider>
  );
};

export default App;