import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const roles = ['ADMIN', 'TEACHER', 'PARENT', 'CSR_PARTNER', 'STUDENT', 'BOARD', 'STAFF'];
const demoRoles = ['ADMIN', 'TEACHER', 'PARENT', 'CSR_PARTNER', 'STUDENT'];
const rubricLevels = ['EE', 'ME', 'AE', 'BE'];
const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const demoLogins = {
  ADMIN: { email: 'admin@cheleta.test', password: 'admin123' },
  TEACHER: { email: 'teacher@cheleta.test', password: 'teacher123' },
  PARENT: { email: 'parent@cheleta.test', password: 'parent123' },
  CSR_PARTNER: { email: 'csr@cheleta.test', password: 'csr123' },
  STUDENT: { email: 'student@cheleta.test', password: 'student123' }
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLearner = { firstName: '', lastName: '', grade: 1, className: '', stream: 'A', support: 'On track', status: 'ACTIVE' };
const emptyTeacher = { name: '', email: '', phone: '', qualification: '', classes: '', password: '', status: 'ACTIVE' };
const emptyClass = { className: '', grade: 7 };
const emptyAccount = { name: '', email: '', password: '', role: 'STAFF', learnerId: '' };
const emptyLearningResource = { category: 'SUBJECT_NOTES', subject: '', title: '', grade: '', content: '', questionsText: '' };
const emptyMentorshipProgram = { title: '', description: '', mentor: '', grade: '' };
const emptySuggestion = { subject: '', suggestion: '' };
const emptyAssessment = {
  learnerId: '',
  subject: '',
  strand: '',
  subStrand: '',
  competency: '',
  level: 'ME',
  term: 'Term 1',
  date: today(),
  comment: '',
  teacherId: ''
};

async function apiRequest(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    if (response.status === 404) {
      throw new Error('This feature is temporarily unavailable. Please refresh the page and try again.');
    }
    throw new Error(result.message || 'The request could not be completed.');
  }
  return result.data;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('cheleta-token') || '');
  const [user, setUser] = useState(null);
  const [section, setSection] = useState('Dashboard');
  const [dashboard, setDashboard] = useState({ summary: [], actions: [], alerts: [] });
  const [announcements, setAnnouncements] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [resources, setResources] = useState([]);
  const [learners, setLearners] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [parentComments, setParentComments] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [learningResources, setLearningResources] = useState([]);
  const [mentorshipPrograms, setMentorshipPrograms] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [boardProgress, setBoardProgress] = useState({ classes: [], staff: [], activePrograms: 0, suggestions: [] });
  const [assessments, setAssessments] = useState([]);
  const [impact, setImpact] = useState([]);
  const [queue, setQueue] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [loginForm, setLoginForm] = useState({ ...demoLogins.ADMIN, role: 'ADMIN' });
  const [learnerForm, setLearnerForm] = useState(emptyLearner);
  const [learnerEditId, setLearnerEditId] = useState(null);
  const [teacherForm, setTeacherForm] = useState(emptyTeacher);
  const [teacherEditId, setTeacherEditId] = useState(null);
  const [classForm, setClassForm] = useState(emptyClass);
  const [parentCommentDrafts, setParentCommentDrafts] = useState({});
  const [accountForm, setAccountForm] = useState(emptyAccount);
  const [learningResourceForm, setLearningResourceForm] = useState(emptyLearningResource);
  const [mentorshipForm, setMentorshipForm] = useState(emptyMentorshipProgram);
  const [suggestionForm, setSuggestionForm] = useState(emptySuggestion);
  const [assessmentForm, setAssessmentForm] = useState(emptyAssessment);
  const [assessmentEditId, setAssessmentEditId] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [attendanceClass, setAttendanceClass] = useState('');
  const [attendanceHistoryFilters, setAttendanceHistoryFilters] = useState({ date: '', className: '', learner: '' });
  const [attendanceMarks, setAttendanceMarks] = useState({});
  const [assessmentFilters, setAssessmentFilters] = useState({ learnerId: '', subject: '', strand: '', term: '' });
  const [statusText, setStatusText] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const offlineStorageKey = user ? `cheleta-offline-queue:${user.id}` : '';
  const loadGeneration = useRef(0);

  const canManageTeachers = user?.role === 'ADMIN';
  const canCreateLearners = ['ADMIN', 'TEACHER'].includes(user?.role);
  const canManageLearners = user?.role === 'ADMIN';
  const canWriteAssessments = ['ADMIN', 'TEACHER'].includes(user?.role);
  const canWriteAttendance = ['ADMIN', 'TEACHER'].includes(user?.role);
  const activeLearners = useMemo(
    () => learners.filter((learner) => learner.status === 'ACTIVE'),
    [learners]
  );
  const classNames = useMemo(() => classes.map((item) => item.className), [classes]);
  const filteredAssessments = useMemo(() => assessments.filter((assessment) => (
    (!assessmentFilters.learnerId || assessment.learnerId === Number(assessmentFilters.learnerId))
    && (!assessmentFilters.subject || assessment.subject.toLowerCase().includes(assessmentFilters.subject.toLowerCase()))
    && (!assessmentFilters.strand || assessment.strand.toLowerCase().includes(assessmentFilters.strand.toLowerCase()))
    && (!assessmentFilters.term || assessment.term.toLowerCase().includes(assessmentFilters.term.toLowerCase()))
  )), [assessments, assessmentFilters]);
  const assessmentLevelCounts = useMemo(
    () => rubricLevels.map((level) => ({ level, count: assessments.filter((assessment) => assessment.level === level).length })),
    [assessments]
  );
  const maxAssessmentLevelCount = Math.max(1, ...assessmentLevelCounts.map((item) => item.count));
  const filteredAttendance = useMemo(() => attendance.filter((record) => (
    (!attendanceHistoryFilters.date || record.date === attendanceHistoryFilters.date)
    && (!attendanceHistoryFilters.className || record.className === attendanceHistoryFilters.className)
    && (!attendanceHistoryFilters.learner || record.learner.toLowerCase().includes(attendanceHistoryFilters.learner.toLowerCase()))
  )), [attendance, attendanceHistoryFilters]);

  const loadData = useCallback(async (activeToken, activeUser) => {
    if (!activeToken || !activeUser) return;
    const generation = ++loadGeneration.current;
    const commonRequests = [
      apiRequest('/api/dashboard', activeToken),
      apiRequest('/api/announcements', activeToken),
      apiRequest('/api/resources', activeToken)
    ];
    const restrictedRequests = [
      !['CSR_PARTNER', 'BOARD'].includes(activeUser.role)
        ? apiRequest('/api/learners', activeToken)
        : Promise.resolve([]),
      activeUser.role === 'ADMIN'
        ? apiRequest('/api/teachers', activeToken)
        : Promise.resolve([]),
      activeUser.role === 'ADMIN'
        ? apiRequest('/api/staff', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(activeUser.role)
        ? apiRequest('/api/learning-resources', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(activeUser.role)
        ? apiRequest('/api/mentorship', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'STUDENT'].includes(activeUser.role)
        ? apiRequest('/api/suggestions', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'BOARD'].includes(activeUser.role)
        ? apiRequest('/api/board/progress', activeToken)
        : Promise.resolve({ classes: [], staff: [], activePrograms: 0, suggestions: [] }),
      ['ADMIN', 'TEACHER', 'PARENT'].includes(activeUser.role)
        ? apiRequest('/api/classes', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'TEACHER', 'PARENT'].includes(activeUser.role)
        ? apiRequest('/api/parent-comments', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'].includes(activeUser.role)
        ? apiRequest('/api/attendance', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'].includes(activeUser.role)
        ? apiRequest('/api/assessments', activeToken)
        : Promise.resolve([]),
      ['ADMIN', 'CSR_PARTNER'].includes(activeUser.role)
        ? apiRequest('/api/impact', activeToken)
        : Promise.resolve([])
    ];
    const [dashboardData, announcementData, resourceData, learnerData, teacherData, accountData, learningData, mentorshipData, suggestionData, boardData, classData, parentCommentData, attendanceData, assessmentData, impactData] =
      await Promise.all([...commonRequests, ...restrictedRequests]);
    if (generation !== loadGeneration.current) return;
    setDashboard(dashboardData);
    setAnnouncements(announcementData);
    setResources(resourceData);
    setLearners(learnerData);
    setTeachers(teacherData);
    setStaffAccounts(accountData);
    setLearningResources(learningData);
    setMentorshipPrograms(mentorshipData);
    setSuggestions(suggestionData);
    setBoardProgress(boardData);
    setClasses(classData);
    setParentComments(parentCommentData);
    setAttendance(attendanceData);
    setAssessments(assessmentData);
    setImpact(impactData);
  }, []);

  const clearUserData = () => {
    setDashboard({ summary: [], actions: [], alerts: [] });
    setAnnouncements([]);
    setAttendance([]);
    setResources([]);
    setLearners([]);
    setTeachers([]);
    setStaffAccounts([]);
    setLearningResources([]);
    setMentorshipPrograms([]);
    setSuggestions([]);
    setBoardProgress({ classes: [], staff: [], activePrograms: 0, suggestions: [] });
    setClasses([]);
    setParentComments([]);
    setAssessments([]);
    setImpact([]);
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    apiRequest('/api/me', token)
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((error) => {
        console.error('Session validation failed:', error);
        loadGeneration.current += 1;
        clearUserData();
        sessionStorage.removeItem('cheleta-token');
        setToken('');
        setUser(null);
        setStatusText('Your session expired. Please sign in again.');
      });
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    loadData(token, user).catch((error) => {
      console.error('Dashboard data request failed:', error);
      setStatusText(error.message);
    });
  }, [token, user, loadData]);

  useEffect(() => {
    if (!user) {
      setQueue([]);
      return;
    }
    const savedQueue = JSON.parse(localStorage.getItem(`cheleta-offline-queue:${user.id}`) || '[]');
    setQueue(savedQueue);
  }, [user?.id]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  }, []);

  const refreshData = async () => {
    await loadData(token, user);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await apiRequest('/api/login', '', {
        method: 'POST',
        body: JSON.stringify(loginForm)
      });
      loadGeneration.current += 1;
      clearUserData();
      sessionStorage.setItem('cheleta-token', result.token);
      setToken(result.token);
      setUser(result.user);
      setSection('Dashboard');
      setStatusText(`Signed in as ${result.user.name}.`);
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    loadGeneration.current += 1;
    clearUserData();
    sessionStorage.removeItem('cheleta-token');
    setToken('');
    setUser(null);
    setQueue([]);
    setSection('Dashboard');
    setStatusText('You have signed out.');
  };

  const chooseDemoRole = (role) => {
    setLoginForm({ ...(demoLogins[role] || { email: '', password: '' }), role });
  };

  const saveLearner = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(learnerEditId ? `/api/learners/${learnerEditId}` : '/api/learners', token, {
        method: learnerEditId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...learnerForm,
          grade: Number(classes.find((item) => item.className === learnerForm.className)?.grade || learnerForm.grade)
        })
      });
      setLearnerForm(emptyLearner);
      setLearnerEditId(null);
      setStatusText(learnerEditId ? 'Learner profile updated.' : 'Learner profile created.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveClass = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/classes', token, {
        method: 'POST',
        body: JSON.stringify({ ...classForm, grade: Number(classForm.grade) })
      });
      setClassForm(emptyClass);
      setStatusText('Class added.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const removeClass = async (className) => {
    if (!window.confirm(`Remove ${className}? Classes with learner records cannot be removed.`)) return;
    try {
      await apiRequest(`/api/classes/${encodeURIComponent(className)}`, token, { method: 'DELETE' });
      setStatusText(`${className} was removed.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const saveAccount = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/staff', token, {
        method: 'POST',
        body: JSON.stringify({
          ...accountForm,
          learnerId: accountForm.learnerId ? Number(accountForm.learnerId) : undefined
        })
      });
      setAccountForm(emptyAccount);
      setStatusText('School account created.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveLearningResource = async (event) => {
    event.preventDefault();
    const questions = learningResourceForm.questionsText.split('\n')
      .map((line) => line.split('|').map((part) => part.trim()))
      .filter(([question, answer]) => question && answer)
      .map(([question, answer]) => ({ question, answer }));
    setBusy(true);
    try {
      await apiRequest('/api/learning-resources', token, {
        method: 'POST',
        body: JSON.stringify({
          ...learningResourceForm,
          grade: learningResourceForm.grade ? Number(learningResourceForm.grade) : null,
          questions
        })
      });
      setLearningResourceForm(emptyLearningResource);
      setStatusText('Learning resource published.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveMentorshipProgram = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/mentorship', token, {
        method: 'POST',
        body: JSON.stringify({
          ...mentorshipForm,
          grade: mentorshipForm.grade ? Number(mentorshipForm.grade) : null
        })
      });
      setMentorshipForm(emptyMentorshipProgram);
      setStatusText('Mentorship program created.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const enrollMentorship = async (program) => {
    try {
      await apiRequest(`/api/mentorship/${program.id}/enroll`, token, { method: 'POST' });
      setStatusText(`You joined ${program.title}.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const closeMentorshipProgram = async (program) => {
    if (!window.confirm(`Close the ${program.title} program?`)) return;
    try {
      await apiRequest(`/api/mentorship/${program.id}`, token, { method: 'DELETE' });
      setStatusText(`${program.title} was closed.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const submitSuggestion = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/suggestions', token, {
        method: 'POST',
        body: JSON.stringify(suggestionForm)
      });
      setSuggestionForm(emptySuggestion);
      setStatusText('Your suggestion was sent to the school admin.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateSuggestionStatus = async (suggestion, status) => {
    try {
      await apiRequest(`/api/suggestions/${suggestion.id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      setStatusText('Suggestion status updated.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const deactivateAccount = async (account) => {
    if (!window.confirm(`Deactivate ${account.name}'s ${account.role.toLowerCase()} sign-in?`)) return;
    try {
      await apiRequest(`/api/staff/${account.id}`, token, { method: 'DELETE' });
      setStatusText(`${account.name}'s account was deactivated.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const saveParentComment = async (event, learner) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/parent-comments', token, {
        method: 'POST',
        body: JSON.stringify({ learnerId: learner.id, comment: parentCommentDrafts[learner.id] || '' })
      });
      setParentCommentDrafts((current) => ({ ...current, [learner.id]: '' }));
      setStatusText('Your comment was submitted.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTeacher = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(teacherEditId ? `/api/teachers/${teacherEditId}` : '/api/teachers', token, {
        method: teacherEditId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...teacherForm,
          classes: teacherForm.classes.split(',').map((name) => name.trim()).filter(Boolean)
        })
      });
      setTeacherForm(emptyTeacher);
      setTeacherEditId(null);
      setStatusText(teacherEditId ? 'Teacher profile updated.' : 'Teacher profile and sign-in created.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const archiveLearner = async (learner) => {
    if (!window.confirm(`Archive ${learner.name}? Attendance and assessment history will be retained.`)) return;
    try {
      await apiRequest(`/api/learners/${learner.id}`, token, { method: 'DELETE' });
      setStatusText(`${learner.name} was archived. History has been retained.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const deactivateTeacher = async (teacher) => {
    if (!window.confirm(`Deactivate ${teacher.name}'s sign-in? Historical records will be retained.`)) return;
    try {
      await apiRequest(`/api/teachers/${teacher.id}`, token, { method: 'DELETE' });
      setStatusText(`${teacher.name} was deactivated.`);
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const saveAssessment = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(assessmentEditId ? `/api/assessments/${assessmentEditId}` : '/api/assessments', token, {
        method: assessmentEditId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...assessmentForm,
          learnerId: Number(assessmentForm.learnerId),
          teacherId: assessmentForm.teacherId ? Number(assessmentForm.teacherId) : undefined
        })
      });
      setAssessmentForm(emptyAssessment);
      setAssessmentEditId(null);
      setStatusText(assessmentEditId ? 'Assessment updated.' : 'Assessment saved.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveAttendance = async (event) => {
    event.preventDefault();
    const classLearners = learners.filter((learner) => !attendanceClass || learner.className === attendanceClass);
    const records = classLearners.map((learner) => ({
      learnerId: learner.id,
      status: attendanceMarks[learner.id] || 'PRESENT',
      date: attendanceDate,
      clientRecordId: crypto.randomUUID()
    }));
    if (!records.length) {
      setStatusText('There are no learners available for this class.');
      return;
    }

    if (!isOnline) {
      setQueue((current) => {
        const next = [...current, ...records];
        localStorage.setItem(offlineStorageKey, JSON.stringify(next));
        return next;
      });
      setStatusText(`${records.length} attendance records saved offline and waiting to sync.`);
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest('/api/attendance', token, {
        method: 'POST',
        body: JSON.stringify({ records })
      });
      setStatusText(`Attendance saved. ${result.duplicatesIgnored} duplicate records were ignored.`);
      await refreshData();
    } catch (error) {
      if (!navigator.onLine) {
        setQueue((current) => {
          const next = [...current, ...records];
          localStorage.setItem(offlineStorageKey, JSON.stringify(next));
          return next;
        });
        setStatusText('Connection lost. Attendance has been queued for synchronization.');
      } else {
        setStatusText(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const syncOfflineAttendance = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const pending = JSON.parse(localStorage.getItem(offlineStorageKey) || '[]');
    if (!pending.length) return;
    try {
      await apiRequest('/api/attendance', token, {
        method: 'POST',
        body: JSON.stringify({ records: pending })
      });
      const syncedIds = new Set(pending.map((record) => record.clientRecordId));
      setQueue((current) => {
        const remaining = current.filter((record) => !syncedIds.has(record.clientRecordId));
        localStorage.setItem(offlineStorageKey, JSON.stringify(remaining));
        return remaining;
      });
      setStatusText(`${pending.length} offline attendance records synchronized.`);
      await loadData(token, user);
    } catch (error) {
      console.error('Offline attendance synchronization failed:', error);
      setStatusText(`Attendance is still waiting to sync: ${error.message}`);
    }
  }, [token, user, loadData, offlineStorageKey]);

  useEffect(() => {
    if (isOnline && user && queue.length) syncOfflineAttendance();
  }, [isOnline, user, queue.length, syncOfflineAttendance]);

  const updateAttendance = async (record, status) => {
    try {
      await apiRequest(`/api/attendance/${record.id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      setStatusText('Attendance record updated.');
      await refreshData();
    } catch (error) {
      setStatusText(error.message);
    }
  };

  const installPwa = async () => {
    if (!installPrompt) {
      setStatusText('Install is available from your browser menu when supported.');
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const editLearner = (learner) => {
    setLearnerForm({
      firstName: learner.firstName,
      lastName: learner.lastName,
      grade: learner.grade,
      className: learner.className,
      stream: learner.stream,
      support: learner.support,
      status: learner.status
    });
    setLearnerEditId(learner.id);
  };

  const editAssessment = (assessment) => {
    setAssessmentForm({
      learnerId: String(assessment.learnerId),
      subject: assessment.subject,
      strand: assessment.strand,
      subStrand: assessment.subStrand,
      competency: assessment.competency,
      level: assessment.level,
      term: assessment.term,
      date: assessment.date,
      comment: assessment.comment,
      teacherId: String(assessment.teacherId)
    });
    setAssessmentEditId(assessment.id);
  };

  const editTeacher = (teacher) => {
    setTeacherForm({
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone || '',
      qualification: teacher.qualification || '',
      classes: teacher.classes || '',
      password: '',
      status: teacher.status
    });
    setTeacherEditId(teacher.id);
  };

  const navigation = [
    { id: 'Dashboard', label: user?.role === 'PARENT' ? 'Home' : user?.role === 'BOARD' ? 'School progress' : 'Dashboard' },
    ...(!['CSR_PARTNER', 'BOARD'].includes(user?.role)
      ? [{ id: 'Learners', label: user?.role === 'PARENT' ? 'My learner' : 'Learners' }]
      : []),
    ...(canManageTeachers ? [{ id: 'Teachers', label: 'Teachers' }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'Classes', label: 'Classes' }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'Staff', label: 'Staff accounts' }] : []),
    ...(['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(user?.role)
      ? [{ id: 'Learning', label: user?.role === 'STUDENT' ? 'Learning library' : 'Learning resources' }]
      : []),
    ...(['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(user?.role)
      ? [{ id: 'Mentorship', label: 'Mentorship' }]
      : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'Suggestions', label: 'Student suggestions' }] : []),
    ...(user?.role === 'STUDENT' ? [{ id: 'SuggestionBox', label: 'Suggestion box' }] : []),
    ...(['ADMIN', 'TEACHER'].includes(user?.role)
      ? [{ id: 'ParentComments', label: 'Parent comments' }]
      : []),
    ...(['ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'].includes(user?.role)
      ? [
          { id: 'Assessments', label: user?.role === 'PARENT' ? 'Learning progress' : 'Assessments' },
          { id: 'Attendance', label: 'Attendance' }
        ]
      : [])
  ];
  const sectionTitle = navigation.find((item) => item.id === section)?.label || section;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Cheleta Primary School</p>
          <h1>Cheleta SMS</h1>
        </div>
        <div className="topbar-actions">
          <div className={isOnline ? 'connection-status online' : 'connection-status offline'}>
            <span className="dot" />
            {isOnline ? 'Online' : 'Offline — changes will sync'}
          </div>
          <button className="secondary" onClick={installPwa}>Install app</button>
        </div>
      </header>

      {!user ? (
        <main className="login-layout">
          <section className="hero card">
            <div>
              <p className="eyebrow accent">School management</p>
              <h2>Connecting learning, learners, teachers and families.</h2>
              <p className="hero-copy">Sign in to access learner records, attendance, CBC assessments and school updates.</p>
            </div>
            <div className="badge">Student · Staff · Family · Board</div>
          </section>
          <section className="card login-card">
            <h2>Sign in</h2>
            <p className="muted">Sign in with your school account.</p>
            <form onSubmit={handleLogin} className="form-grid">
              <label>Email<input required type="email" autoComplete="username" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} /></label>
              <label>Password<input required type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} /></label>
              <label>Role<select value={loginForm.role} onChange={(event) => chooseDemoRole(event.target.value)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
              <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            <div className="demo-accounts">
              {demoRoles.map((role) => (
                <button className="secondary" type="button" key={role} onClick={() => chooseDemoRole(role)}>
                  {role.replace('_', ' ')}
                </button>
              ))}
            </div>
            {statusText && <p className="status" role="status">{statusText}</p>}
          </section>
        </main>
      ) : (
        <main className="layout">
          <aside className={`sidebar card ${user.role === 'PARENT' ? 'parent-sidebar' : ''}`}>
            <div className="account-summary">
              <p className="eyebrow">Signed in</p>
              <strong>{user.name}</strong>
              <span className="badge">{user.role.replace('_', ' ')}</span>
            </div>
            {user.role === 'PARENT' && (
              <div className="navigation-hint">
                <strong>Family portal</strong>
                <span>Choose a section below to see your child’s school updates.</span>
              </div>
            )}
            <nav className="navigation" aria-label="Main navigation">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  className={section === item.id ? 'nav-item active' : 'nav-item'}
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  <span className="nav-arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </nav>
            <div className="offline-indicator">
              <span className={isOnline ? 'dot' : 'dot warning-dot'} />
              {isOnline ? 'Online' : 'Offline'} · {queue.length} pending
            </div>
            <button className="secondary full signout" onClick={signOut}>Sign out</button>
            {statusText && <p className="status" role="status">{statusText}</p>}
          </aside>

          <section className="content">
            <div className="hero card">
              <div>
                <p className="eyebrow accent">{sectionTitle}</p>
                <h2>{section === 'Dashboard' ? `Welcome, ${user.name}` : sectionTitle}</h2>
                {section === 'Dashboard' && (
                  <p className="hero-copy">
                    {user.role === 'PARENT'
                      ? 'Your child’s attendance, learning progress, and school updates are together here.'
                      : 'A clear view of school records and learning activity.'}
                  </p>
                )}
              </div>
            </div>

            {section === 'Dashboard' && (
              <>
                <div className="stats-grid">
                  {dashboard.summary?.map((item) => (
                    <article key={item.label} className="card stat-card">
                      <p>{item.label}</p><strong>{item.value}</strong><span>{item.meta}</span>
                    </article>
                  ))}
                </div>
                {user.role === 'BOARD' && (
                  <section className="card panel">
                    <h3>School progress by class</h3>
                    <div className="table-wrap"><table><thead><tr><th>Class</th><th>Learners</th><th>Attendance</th><th>Assessments</th><th>Attendance records</th></tr></thead><tbody>
                      {boardProgress.classes.map((item) => <tr key={item.className}><td>Grade {item.grade} · {item.className}</td><td>{item.learners}</td><td>{item.attendanceRate}%</td><td>{item.assessments}</td><td>{item.attendanceRecords}</td></tr>)}
                    </tbody></table></div>
                    {boardProgress.classes.length === 0 && <p className="muted">School class progress will appear as records are added.</p>}
                    <div className="item-row"><div><strong>Active mentorship programs</strong></div><span>{boardProgress.activePrograms}</span></div>
                    <h3>Student suggestions overview</h3>
                    {boardProgress.suggestions.map((item) => <div key={item.status} className="item-row"><div><strong>{item.status.replace('_', ' ')}</strong></div><span>{item.count}</span></div>)}
                  </section>
                )}
                <div className="panel-grid">
                  <section className="card panel">
                    <h3>Quick actions</h3>
                    {user.role === 'PARENT' ? (
                      <div className="family-actions">
                        <button className="family-action" onClick={() => setSection('Learners')}>
                          <span className="family-action-icon" aria-hidden="true">01</span>
                          <span><strong>See my learner</strong><small>Class, attendance, and support</small></span>
                          <span className="nav-arrow" aria-hidden="true">›</span>
                        </button>
                        <button className="family-action" onClick={() => setSection('Assessments')}>
                          <span className="family-action-icon teal-icon" aria-hidden="true">02</span>
                          <span><strong>See learning progress</strong><small>Teacher feedback and CBC progress</small></span>
                          <span className="nav-arrow" aria-hidden="true">›</span>
                        </button>
                        <button className="family-action" onClick={() => setSection('Attendance')}>
                          <span className="family-action-icon coral-icon" aria-hidden="true">03</span>
                          <span><strong>Check attendance</strong><small>Review days present and absent</small></span>
                          <span className="nav-arrow" aria-hidden="true">›</span>
                        </button>
                      </div>
                    ) : (
                      <ul className="action-list">{dashboard.actions?.map((action) => <li key={action}>{action}</li>)}</ul>
                    )}
                  </section>
                  <section className="card panel">
                    <h3>Updates</h3>
                    <ul className="alert-list">{dashboard.alerts?.map((alert) => <li key={alert}>{alert}</li>)}</ul>
                  </section>
                </div>
                <div className="panel-grid">
                  <section className="card panel">
                    <h3>Announcements</h3>
                    {announcements.length ? announcements.map((item) => (
                      <div key={item.id} className="item-row"><div><strong>{item.title}</strong><p>{item.message}</p></div><span>{item.priority}</span></div>
                    )) : <p className="muted">No announcements are available yet.</p>}
                  </section>
                  {user.role === 'CSR_PARTNER' ? (
                    <section className="card panel">
                      <h3>Aggregate CSR impact</h3>
                      {impact.map((entry) => <div key={entry.label} className="item-row"><div><strong>{entry.label}</strong><p>{entry.caption}</p></div><span>{entry.value}</span></div>)}
                    </section>
                  ) : (
                    <section className="card panel">
                      <h3>Learning resources</h3>
                      {resources.length ? resources.map((resource) => <div key={resource.id} className="item-row"><div><strong>{resource.title}</strong><p>{resource.subject}</p></div><span>{resource.type}</span></div>) : <p className="muted">No resources have been published yet.</p>}
                    </section>
                  )}
                </div>
              </>
            )}

            {section === 'Learners' && (
              <>
                {canCreateLearners && (
                  <section className="card panel">
                    <h3>{learnerEditId ? 'Edit learner profile' : 'Register learner'}</h3>
                    <form className="form-grid form-grid-three" onSubmit={saveLearner}>
                      <label>First name<input required maxLength="80" value={learnerForm.firstName} onChange={(event) => setLearnerForm({ ...learnerForm, firstName: event.target.value })} /></label>
                      <label>Last name<input required maxLength="80" value={learnerForm.lastName} onChange={(event) => setLearnerForm({ ...learnerForm, lastName: event.target.value })} /></label>
                      <label>Class<select required value={learnerForm.className} onChange={(event) => setLearnerForm({ ...learnerForm, className: event.target.value })}><option value="">Select class</option>{classes.map((item) => <option key={item.className} value={item.className}>Grade {item.grade}{item.grade >= 7 ? ' · Junior Secondary' : ''} — {item.className}</option>)}</select></label>
                      <label>Stream<input required value={learnerForm.stream} onChange={(event) => setLearnerForm({ ...learnerForm, stream: event.target.value })} /></label>
                      <label>Support note<input value={learnerForm.support} onChange={(event) => setLearnerForm({ ...learnerForm, support: event.target.value })} /></label>
                      {canManageLearners && learnerEditId && <label>Record status<select value={learnerForm.status} onChange={(event) => setLearnerForm({ ...learnerForm, status: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label>}
                      <div className="form-actions">
                        <button className="primary" disabled={busy}>{learnerEditId ? 'Save changes' : 'Create learner'}</button>
                        {learnerEditId && <button type="button" className="secondary" onClick={() => { setLearnerForm(emptyLearner); setLearnerEditId(null); }}>Cancel</button>}
                      </div>
                    </form>
                  </section>
                )}
                <section className="card panel">
                  <h3>{user.role === 'PARENT' ? 'Linked learner records' : 'Learner records'} <span className="count-badge">{learners.length}</span></h3>
                  <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Grade / class</th><th>Attendance</th><th>Support</th>{canManageLearners && <><th>Status</th><th>Manage</th></>}</tr></thead>
                    <tbody>{learners.map((learner) => <tr key={learner.id}><td>{learner.name}</td><td>Grade {learner.grade}{learner.grade >= 7 ? ' · Junior Secondary' : ''} · {learner.className}</td><td>{learner.attendance}%</td><td>{learner.support}</td>{canManageLearners && <><td>{learner.status}</td><td className="action-cell"><button className="secondary small-button" onClick={() => editLearner(learner)}>Edit</button>{learner.status === 'ACTIVE' && <button className="secondary small-button" onClick={() => archiveLearner(learner)}>Archive</button>}</td></>}</tr>)}</tbody>
                  </table></div>
                  {learners.length === 0 && <p className="muted">No learner records are available for this account.</p>}
                </section>
                {user.role === 'PARENT' && learners.map((learner) => {
                  const existingComment = parentComments.find((entry) => entry.learnerId === learner.id);
                  return (
                    <section className="card panel" key={`parent-comment-${learner.id}`}>
                      <h3>Comment about {learner.name}</h3>
                      {existingComment ? (
                        <p>{existingComment.comment}<br /><span className="muted">Submitted {existingComment.createdAt}</span></p>
                      ) : (
                        <form className="form-grid" onSubmit={(event) => saveParentComment(event, learner)}>
                          <label>Your comment<textarea required maxLength="1000" rows="4" value={parentCommentDrafts[learner.id] || ''} onChange={(event) => setParentCommentDrafts({ ...parentCommentDrafts, [learner.id]: event.target.value })} /></label>
                          <p className="muted">You can submit one comment for this learner. It cannot be edited after submission.</p>
                          <button className="primary" disabled={busy}>Submit comment</button>
                        </form>
                      )}
                    </section>
                  );
                })}
              </>
            )}

            {section === 'Classes' && user.role === 'ADMIN' && (
              <>
                <section className="card panel">
                  <h3>Add a class</h3>
                  <form className="form-grid form-grid-three" onSubmit={saveClass}>
                    <label>Class name<input required maxLength="60" placeholder="Grade 9A" value={classForm.className} onChange={(event) => setClassForm({ ...classForm, className: event.target.value })} /></label>
                    <label>Grade<select value={classForm.grade} onChange={(event) => setClassForm({ ...classForm, grade: event.target.value })}>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>Grade {index + 1}{index >= 6 ? ' · Junior Secondary' : ''}</option>)}</select></label>
                    <div className="form-actions"><button className="primary" disabled={busy}>Add class</button></div>
                  </form>
                </section>
                <section className="card panel">
                  <h3>Classes <span className="count-badge">{classes.length}</span></h3>
                  <div className="table-wrap"><table><thead><tr><th>Class</th><th>Level</th><th>Learners</th><th>Manage</th></tr></thead><tbody>
                    {classes.map((item) => {
                      const learnerCount = learners.filter((learner) => learner.className === item.className).length;
                      return <tr key={item.className}><td>{item.className}</td><td>Grade {item.grade}{item.grade >= 7 ? ' · Junior Secondary' : ''}</td><td>{learnerCount}</td><td><button className="secondary small-button" disabled={learnerCount > 0} onClick={() => removeClass(item.className)}>Remove</button></td></tr>;
                    })}
                  </tbody></table></div>
                  <p className="muted">Classes with learner records cannot be removed, so learner history is preserved.</p>
                </section>
              </>
            )}

            {section === 'ParentComments' && ['ADMIN', 'TEACHER'].includes(user.role) && (
              <section className="card panel">
                <h3>Parent comments <span className="count-badge">{parentComments.length}</span></h3>
                <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Parent</th><th>Comment</th><th>Submitted</th></tr></thead><tbody>
                  {parentComments.map((entry) => <tr key={entry.id}><td>{entry.learner}</td><td>{entry.className}</td><td>{entry.parent}</td><td>{entry.comment}</td><td>{entry.createdAt}</td></tr>)}
                </tbody></table></div>
                {parentComments.length === 0 && <p className="muted">No parent comments have been submitted.</p>}
              </section>
            )}

            {section === 'Staff' && user.role === 'ADMIN' && (
              <>
                <section className="card panel">
                  <h3>Add a school account</h3>
                  <p className="muted">Create sign-ins for non-teaching staff, Board members, or learners. Teacher accounts are managed in the Teachers section.</p>
                  <form className="form-grid form-grid-three" onSubmit={saveAccount}>
                    <label>Full name<input required maxLength="120" value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} /></label>
                    <label>Email<input required type="email" value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} /></label>
                    <label>Temporary password<input required type="password" minLength="8" autoComplete="new-password" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} /></label>
                    <label>Account type<select value={accountForm.role} onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value, learnerId: '' })}><option value="STAFF">School staff</option><option value="BOARD">Board of Management</option><option value="STUDENT">Learner</option></select></label>
                    {accountForm.role === 'STUDENT' && <label>Learner<select required value={accountForm.learnerId} onChange={(event) => setAccountForm({ ...accountForm, learnerId: event.target.value })}><option value="">Select learner</option>{activeLearners.filter((learner) => !staffAccounts.some((account) => account.role === 'STUDENT' && account.status === 'ACTIVE' && account.learnerId === learner.id)).map((learner) => <option key={learner.id} value={learner.id}>{learner.name} · {learner.className}</option>)}</select></label>}
                    <div className="form-actions"><button className="primary" disabled={busy}>Create account</button></div>
                  </form>
                </section>
                <section className="card panel">
                  <h3>School accounts <span className="count-badge">{staffAccounts.length}</span></h3>
                  <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Learner</th><th>Status</th><th>Manage</th></tr></thead><tbody>
                    {staffAccounts.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.email}</td><td>{account.role}</td><td>{account.learner || '—'}</td><td>{account.status}</td><td>{account.status === 'ACTIVE' && <button className="secondary small-button" onClick={() => deactivateAccount(account)}>Deactivate</button>}</td></tr>)}
                  </tbody></table></div>
                </section>
              </>
            )}

            {section === 'Learning' && ['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(user.role) && (
              <>
                {user.role === 'ADMIN' && (
                  <section className="card panel">
                    <h3>Publish learning material</h3>
                    <form className="form-grid form-grid-three" onSubmit={saveLearningResource}>
                      <label>Resource type<select value={learningResourceForm.category} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, category: event.target.value })}><option value="SUBJECT_NOTES">Subject notes</option><option value="CAREER_READINESS">Career readiness</option><option value="CODING_BOOTCAMP">Coding bootcamp</option></select></label>
                      <label>Subject<input required maxLength="100" value={learningResourceForm.subject} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, subject: event.target.value })} /></label>
                      <label>Grade<select value={learningResourceForm.grade} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, grade: event.target.value })}><option value="">All grades</option>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>Grade {index + 1}</option>)}</select></label>
                      <label className="wide-field">Title<input required maxLength="180" value={learningResourceForm.title} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, title: event.target.value })} /></label>
                      <label className="wide-field">Notes<textarea required maxLength="12000" rows="5" value={learningResourceForm.content} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, content: event.target.value })} /></label>
                      <label className="wide-field">Revision questions (one per line, format: question | answer)<textarea rows="4" placeholder="What is an algorithm? | A clear sequence of steps for solving a problem." value={learningResourceForm.questionsText} onChange={(event) => setLearningResourceForm({ ...learningResourceForm, questionsText: event.target.value })} /></label>
                      <div className="form-actions"><button className="primary" disabled={busy}>Publish resource</button></div>
                    </form>
                  </section>
                )}
                <section className="card panel">
                  <h3>{user.role === 'STUDENT' ? 'Notes and revision library' : 'Published learning resources'} <span className="count-badge">{learningResources.length}</span></h3>
                  {learningResources.map((item) => (
                    <details key={item.id} className="item-row">
                      <summary><strong>{item.title}</strong> · {item.subject} · {item.category.replaceAll('_', ' ')}{item.grade ? ` · Grade ${item.grade}` : ' · All grades'}</summary>
                      <p>{item.content}</p>
                      {item.questions.length > 0 && <div><strong>Revision questions</strong>{item.questions.map((question) => <details key={question.id}><summary>{question.question}</summary><p>{question.answer}</p></details>)}</div>}
                    </details>
                  ))}
                  {learningResources.length === 0 && <p className="muted">No learning resources are available yet.</p>}
                </section>
              </>
            )}

            {section === 'Mentorship' && ['ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(user.role) && (
              <>
                {user.role === 'ADMIN' && (
                  <section className="card panel">
                    <h3>Create a mentorship program</h3>
                    <form className="form-grid form-grid-three" onSubmit={saveMentorshipProgram}>
                      <label>Program name<input required maxLength="180" value={mentorshipForm.title} onChange={(event) => setMentorshipForm({ ...mentorshipForm, title: event.target.value })} /></label>
                      <label>Mentor or team<input required maxLength="120" value={mentorshipForm.mentor} onChange={(event) => setMentorshipForm({ ...mentorshipForm, mentor: event.target.value })} /></label>
                      <label>Grade<select value={mentorshipForm.grade} onChange={(event) => setMentorshipForm({ ...mentorshipForm, grade: event.target.value })}><option value="">All grades</option>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>Grade {index + 1}</option>)}</select></label>
                      <label className="wide-field">Description<textarea required maxLength="2000" rows="3" value={mentorshipForm.description} onChange={(event) => setMentorshipForm({ ...mentorshipForm, description: event.target.value })} /></label>
                      <div className="form-actions"><button className="primary" disabled={busy}>Create program</button></div>
                    </form>
                  </section>
                )}
                <section className="card panel">
                  <h3>Mentorship programs</h3>
                  {mentorshipPrograms.map((program) => (
                    <div key={program.id} className="item-row">
                      <div><strong>{program.title}</strong><p>{program.description}</p><p className="muted">Mentor: {program.mentor} · {program.grade ? `Grade ${program.grade}` : 'All grades'} · {program.enrollmentCount} learner(s) enrolled</p></div>
                      {user.role === 'STUDENT' && program.status === 'ACTIVE' && (program.enrolled
                        ? <span>Joined</span>
                        : <button className="primary small-button" onClick={() => enrollMentorship(program)}>Join program</button>)}
                      {user.role === 'ADMIN' && program.status === 'ACTIVE' && <button className="secondary small-button" onClick={() => closeMentorshipProgram(program)}>Close program</button>}
                      {program.status !== 'ACTIVE' && <span>Closed</span>}
                    </div>
                  ))}
                  {mentorshipPrograms.length === 0 && <p className="muted">No mentorship programs are available yet.</p>}
                </section>
              </>
            )}

            {section === 'SuggestionBox' && user.role === 'STUDENT' && (
              <>
                <section className="card panel">
                  <h3>Share an idea with the school</h3>
                  <p className="muted">Your suggestion goes directly to the school admin for review.</p>
                  <form className="form-grid" onSubmit={submitSuggestion}>
                    <label>Subject<input required maxLength="100" value={suggestionForm.subject} onChange={(event) => setSuggestionForm({ ...suggestionForm, subject: event.target.value })} /></label>
                    <label>Your idea<textarea required maxLength="2000" rows="4" value={suggestionForm.suggestion} onChange={(event) => setSuggestionForm({ ...suggestionForm, suggestion: event.target.value })} /></label>
                    <button className="primary" disabled={busy}>Send suggestion</button>
                  </form>
                </section>
                <section className="card panel"><h3>My suggestions</h3>{suggestions.map((item) => <div className="item-row" key={item.id}><div><strong>{item.subject}</strong><p>{item.suggestion}</p></div><span>{item.status.replace('_', ' ')}</span></div>)}</section>
              </>
            )}

            {section === 'Suggestions' && user.role === 'ADMIN' && (
              <section className="card panel">
                <h3>Student suggestions <span className="count-badge">{suggestions.length}</span></h3>
                <div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Subject</th><th>Suggestion</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
                  {suggestions.map((item) => <tr key={item.id}><td>{item.learner}</td><td>{item.className}</td><td>{item.subject}</td><td>{item.suggestion}</td><td>{item.createdAt}</td><td><select value={item.status} onChange={(event) => updateSuggestionStatus(item, event.target.value)}><option value="NEW">New</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option></select></td></tr>)}
                </tbody></table></div>
                {suggestions.length === 0 && <p className="muted">There are no student suggestions yet.</p>}
              </section>
            )}

            {section === 'Teachers' && canManageTeachers && (
              <>
                <section className="card panel">
                  <h3>{teacherEditId ? 'Edit teacher profile' : 'Create teacher profile and sign-in'}</h3>
                  <form className="form-grid form-grid-three" onSubmit={saveTeacher}>
                    <label>Full name<input required maxLength="120" value={teacherForm.name} onChange={(event) => setTeacherForm({ ...teacherForm, name: event.target.value })} /></label>
                    <label>Email<input required type="email" value={teacherForm.email} onChange={(event) => setTeacherForm({ ...teacherForm, email: event.target.value })} /></label>
                    <label>Phone<input value={teacherForm.phone} onChange={(event) => setTeacherForm({ ...teacherForm, phone: event.target.value })} /></label>
                    <label>Qualification<input value={teacherForm.qualification} onChange={(event) => setTeacherForm({ ...teacherForm, qualification: event.target.value })} /></label>
                    {!teacherEditId && <label>Temporary password<input required minLength="8" type="password" value={teacherForm.password} onChange={(event) => setTeacherForm({ ...teacherForm, password: event.target.value })} /></label>}
                    {teacherEditId && <label>Account status<select value={teacherForm.status} onChange={(event) => setTeacherForm({ ...teacherForm, status: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label>}
                    <label className="wide-field">Assigned classes (comma-separated)<input placeholder="Grade 5A, Grade 6A" value={teacherForm.classes} onChange={(event) => setTeacherForm({ ...teacherForm, classes: event.target.value })} /></label>
                    <div className="form-actions"><button className="primary" disabled={busy}>{teacherEditId ? 'Save changes' : 'Create teacher'}</button>{teacherEditId && <button type="button" className="secondary" onClick={() => { setTeacherForm(emptyTeacher); setTeacherEditId(null); }}>Cancel</button>}</div>
                  </form>
                </section>
                <section className="card panel">
                  <h3>Teacher roster</h3>
                  <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Classes</th><th>Status</th><th>Manage</th></tr></thead><tbody>{teachers.map((teacher) => <tr key={teacher.id}><td>{teacher.name}</td><td>{teacher.email}</td><td>{teacher.classes || '—'}</td><td>{teacher.status}</td><td className="action-cell"><button className="secondary small-button" onClick={() => editTeacher(teacher)}>Edit</button>{teacher.status === 'ACTIVE' && <button className="secondary small-button" onClick={() => deactivateTeacher(teacher)}>Deactivate</button>}</td></tr>)}</tbody></table></div>
                </section>
              </>
            )}

            {section === 'Assessments' && (
              <>
                {canWriteAssessments && activeLearners.length > 0 && (
                  <section className="card panel">
                    <h3>{assessmentEditId ? 'Edit CBC assessment' : 'Record CBC assessment'}</h3>
                    <form className="form-grid form-grid-three" onSubmit={saveAssessment}>
                      <label>Learner<select required value={assessmentForm.learnerId} onChange={(event) => setAssessmentForm({ ...assessmentForm, learnerId: event.target.value })}><option value="">Select learner</option>{activeLearners.map((learner) => <option key={learner.id} value={learner.id}>{learner.name} — {learner.className}</option>)}</select></label>
                      <label>Subject<input required value={assessmentForm.subject} onChange={(event) => setAssessmentForm({ ...assessmentForm, subject: event.target.value })} /></label>
                      <label>Strand<input required value={assessmentForm.strand} onChange={(event) => setAssessmentForm({ ...assessmentForm, strand: event.target.value })} /></label>
                      <label>Sub-strand<input required value={assessmentForm.subStrand} onChange={(event) => setAssessmentForm({ ...assessmentForm, subStrand: event.target.value })} /></label>
                      <label>Competency<input required value={assessmentForm.competency} onChange={(event) => setAssessmentForm({ ...assessmentForm, competency: event.target.value })} /></label>
                      <label>Rubric level<select value={assessmentForm.level} onChange={(event) => setAssessmentForm({ ...assessmentForm, level: event.target.value })}>{rubricLevels.map((level) => <option key={level}>{level}</option>)}</select></label>
                      <label>Term<input required value={assessmentForm.term} onChange={(event) => setAssessmentForm({ ...assessmentForm, term: event.target.value })} /></label>
                      <label>Date<input required type="date" value={assessmentForm.date} onChange={(event) => setAssessmentForm({ ...assessmentForm, date: event.target.value })} /></label>
                      {user.role === 'ADMIN' && <label>Teacher<select required value={assessmentForm.teacherId} onChange={(event) => setAssessmentForm({ ...assessmentForm, teacherId: event.target.value })}><option value="">Select teacher</option>{teachers.filter((teacher) => teacher.status === 'ACTIVE').map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>}
                      <label>Teacher comment<input value={assessmentForm.comment} onChange={(event) => setAssessmentForm({ ...assessmentForm, comment: event.target.value })} /></label>
                      <div className="form-actions"><button className="primary" disabled={busy}>{assessmentEditId ? 'Save changes' : 'Save assessment'}</button>{assessmentEditId && <button type="button" className="secondary" onClick={() => { setAssessmentForm(emptyAssessment); setAssessmentEditId(null); }}>Cancel</button>}</div>
                    </form>
                  </section>
                )}
                <section className="card panel">
                  <h3>Assessment history</h3>
                  <div className="assessment-distribution" aria-label="Assessment levels across loaded records">
                    {assessmentLevelCounts.map((item) => <div className="distribution-row" key={item.level}><strong>{item.level}</strong><div className="distribution-track"><span style={{ width: `${(item.count / maxAssessmentLevelCount) * 100}%` }} /></div><span>{item.count}</span></div>)}
                  </div>
                  <div className="form-grid assessment-filters">
                    <label>Learner<select value={assessmentFilters.learnerId} onChange={(event) => setAssessmentFilters({ ...assessmentFilters, learnerId: event.target.value })}><option value="">All available learners</option>{learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.name}</option>)}</select></label>
                    <label>Subject<input placeholder="Filter by subject" value={assessmentFilters.subject} onChange={(event) => setAssessmentFilters({ ...assessmentFilters, subject: event.target.value })} /></label>
                    <label>Strand<input placeholder="Filter by strand" value={assessmentFilters.strand} onChange={(event) => setAssessmentFilters({ ...assessmentFilters, strand: event.target.value })} /></label>
                    <label>Term<input placeholder="Filter by term" value={assessmentFilters.term} onChange={(event) => setAssessmentFilters({ ...assessmentFilters, term: event.target.value })} /></label>
                  </div>
                  <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Subject / strand</th><th>Competency</th><th>Level</th><th>Term / date</th><th>Teacher comment</th>{canWriteAssessments && <th>Manage</th>}</tr></thead>
                    <tbody>{filteredAssessments.map((assessment) => <tr key={assessment.id}><td>{assessment.learner}</td><td>{assessment.subject}<br /><span className="muted">{assessment.strand} · {assessment.subStrand}</span></td><td>{assessment.competency}</td><td><span className="level-badge">{assessment.level}</span></td><td>{assessment.term}<br /><span className="muted">{assessment.date}</span></td><td>{assessment.comment || '—'}</td>{canWriteAssessments && <td><button className="secondary small-button" onClick={() => editAssessment(assessment)}>Edit</button></td>}</tr>)}</tbody>
                  </table></div>
                  {filteredAssessments.length === 0 && <p className="muted">No CBC assessments match these filters.</p>}
                </section>
              </>
            )}

            {section === 'Attendance' && (
              <>
                {canWriteAttendance && (
                  <section className="card panel">
                    <h3>Record daily attendance</h3>
                    <form onSubmit={saveAttendance}>
                      <div className="form-grid attendance-filters">
                        <label>Class<select value={attendanceClass} onChange={(event) => setAttendanceClass(event.target.value)}><option value="">All assigned classes</option>{classNames.map((className) => <option key={className}>{className}</option>)}</select></label>
                        <label>Date<input required type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} /></label>
                      </div>
                      <div className="learner-attendance-list">
                        {activeLearners.filter((learner) => !attendanceClass || learner.className === attendanceClass).map((learner) => (
                          <label key={learner.id} className="attendance-learner">
                            <span><strong>{learner.name}</strong><small>{learner.className}</small></span>
                            <select aria-label={`Attendance for ${learner.name}`} value={attendanceMarks[learner.id] || 'PRESENT'} onChange={(event) => setAttendanceMarks({ ...attendanceMarks, [learner.id]: event.target.value })}>
                              {attendanceStatuses.map((status) => <option key={status}>{status}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      <button className="primary" disabled={busy}>Save attendance</button>
                    </form>
                  </section>
                )}
                <section className="card panel">
                  <h3>{user.role === 'PARENT' ? 'Linked learner attendance' : 'Attendance history'}</h3>
                  <div className="form-grid attendance-history-filters">
                    <label>Date<input type="date" value={attendanceHistoryFilters.date} onChange={(event) => setAttendanceHistoryFilters({ ...attendanceHistoryFilters, date: event.target.value })} /></label>
                    <label>Class<select value={attendanceHistoryFilters.className} onChange={(event) => setAttendanceHistoryFilters({ ...attendanceHistoryFilters, className: event.target.value })}><option value="">All available classes</option>{classNames.map((className) => <option key={className}>{className}</option>)}</select></label>
                    <label>Learner<input placeholder="Search learner" value={attendanceHistoryFilters.learner} onChange={(event) => setAttendanceHistoryFilters({ ...attendanceHistoryFilters, learner: event.target.value })} /></label>
                  </div>
                  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Learner</th><th>Class</th><th>Status</th>{canWriteAttendance && <th>Change status</th>}</tr></thead>
                    <tbody>{filteredAttendance.map((record) => <tr key={record.id}><td>{record.date}</td><td>{record.learner}</td><td>{record.className}</td><td>{record.status}</td>{canWriteAttendance && <td><select aria-label={`Change attendance for ${record.learner}`} value={record.status} onChange={(event) => updateAttendance(record, event.target.value)}>{attendanceStatuses.map((status) => <option key={status}>{status}</option>)}</select></td>}</tr>)}</tbody>
                  </table></div>
                  {filteredAttendance.length === 0 && <p className="muted">No attendance records match these filters.</p>}
                </section>
              </>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
