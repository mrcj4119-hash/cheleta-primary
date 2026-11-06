import { useEffect, useState } from 'react';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const currentDate = () => new Date().toISOString().slice(0, 10);

function payload(body) {
  return { method: 'POST', body: JSON.stringify(body) };
}

function messageFrom(error) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

async function downloadFile(path, token) {
  const response = await fetch(path, { headers: { Authorization: ['Bearer', token].join(' ') } });
  if (!response.ok) {
    let message = 'The download could not be completed.';
    try {
      message = (await response.json()).message || message;
    } catch (error) {
      console.error('Download error response could not be read:', error);
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'cheleta-export';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function SchoolTools({
  section,
  token,
  user,
  learners,
  teachers,
  classes,
  request,
  onStatus,
  onUserUpdate
}) {
  const [records, setRecords] = useState([]);
  const [report, setReport] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedLearner, setSelectedLearner] = useState('');
  const [term, setTerm] = useState('Term 1');
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(`${new Date().getFullYear()}-04-30`);
  const [reportComment, setReportComment] = useState('');
  const [reportTeacher, setReportTeacher] = useState('');
  const [phone, setPhone] = useState(user.phone || '');
  const [smsOptIn, setSmsOptIn] = useState(Boolean(user.smsOptIn));
  const [announcement, setAnnouncement] = useState({ title: '', message: '', priority: 'Normal' });
  const [timetableForm, setTimetableForm] = useState({
    className: '',
    teacherId: user.role === 'TEACHER' ? String(user.teacherId || '') : '',
    dayOfWeek: '1',
    startTime: '08:00',
    endTime: '08:40',
    subject: '',
    room: ''
  });
  const [lessonForm, setLessonForm] = useState({
    className: '',
    teacherId: user.role === 'TEACHER' ? String(user.teacherId || '') : '',
    date: currentDate(),
    subject: '',
    title: '',
    objectives: '',
    plan: ''
  });
  const [wellbeingForm, setWellbeingForm] = useState({
    learnerId: '',
    category: 'WELLBEING',
    concern: ''
  });
  const [inventoryForm, setInventoryForm] = useState({
    name: '',
    category: 'BOOK',
    identifier: '',
    location: '',
    quantity: 1,
    status: 'ACTIVE'
  });
  const [inventoryEditId, setInventoryEditId] = useState(null);
  const [loanForm, setLoanForm] = useState({
    itemId: '',
    learnerId: '',
    checkoutDate: currentDate(),
    dueDate: currentDate()
  });
  const [days, setDays] = useState('30');

  useEffect(() => {
    let active = true;
    setError('');
    const load = async () => {
      try {
        let nextRecords = [];
        if (section === 'Timetable') nextRecords = await request('/api/timetable');
        if (section === 'LessonPlans') nextRecords = await request('/api/lesson-plans');
        if (section === 'Notifications') nextRecords = await Promise.all([
          request('/api/notifications'),
          request('/api/announcements')
        ]);
        if (section === 'Wellbeing') nextRecords = await request('/api/wellbeing');
        if (section === 'Library') {
          const [items, loans] = await Promise.all([
            ['ADMIN', 'STAFF', 'TEACHER'].includes(user.role) ? request('/api/inventory') : Promise.resolve([]),
            request('/api/library/loans')
          ]);
          nextRecords = { items, loans };
        }
        if (section === 'AdminReports') {
          const nextAnalytics = await request(`/api/reports/summary?days=${days}`);
          if (active) setAnalytics(nextAnalytics);
        }
        if (active) setRecords(nextRecords);
      } catch (loadError) {
        if (active) setError(messageFrom(loadError));
      }
    };
    load();
    return () => { active = false; };
  }, [section, request, revision, days, user.role]);

  const listRecords = Array.isArray(records) ? records : [];
  const notificationRecords = Array.isArray(records) && Array.isArray(records[0]) ? records[0] : [];
  const announcementRecords = Array.isArray(records) && Array.isArray(records[1]) ? records[1] : [];

  const perform = async (operation, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      if (successMessage) onStatus(successMessage);
      setRevision((value) => value + 1);
    } catch (operationError) {
      const message = messageFrom(operationError);
      setError(message);
      onStatus(message);
    } finally {
      setBusy(false);
    }
  };

  const submitTimetable = (event) => {
    event.preventDefault();
    perform(
      () => request('/api/timetable', payload({
        ...timetableForm,
        dayOfWeek: Number(timetableForm.dayOfWeek),
        teacherId: Number(timetableForm.teacherId)
      })),
      'Timetable entry added.'
    );
  };

  const submitLesson = (event) => {
    event.preventDefault();
    perform(
      () => request('/api/lesson-plans', payload({
        ...lessonForm,
        teacherId: Number(lessonForm.teacherId)
      })),
      'Lesson plan added.'
    );
  };

  const loadReport = (event) => {
    event.preventDefault();
    perform(async () => {
      const params = new URLSearchParams({
        learnerId: selectedLearner,
        term,
        startDate,
        endDate
      });
      const nextReport = await request(`/api/report-cards?${params}`);
      setReport(nextReport);
      setReportComment(nextReport.teacherComment?.comment || '');
    });
  };

  const saveReportComment = (event) => {
    event.preventDefault();
    perform(
      () => request(`/api/report-cards/${selectedLearner}/comment`, {
        method: 'PUT',
        body: JSON.stringify({ term, comment: reportComment, teacherId: Number(reportTeacher) })
      }),
      'Report comment saved; linked parents were notified.'
    );
  };

  const savePhone = (event) => {
    event.preventDefault();
    perform(async () => {
      const preferences = await request('/api/me/phone', {
        method: 'PUT',
        body: JSON.stringify({ phone, smsOptIn })
      });
      onUserUpdate({ ...user, ...preferences });
    }, 'SMS preferences saved.');
  };

  const publishAnnouncement = (event) => {
    event.preventDefault();
    perform(() => request('/api/announcements', payload(announcement)), 'Announcement sent to parents.');
    setAnnouncement({ title: '', message: '', priority: 'Normal' });
  };

  const submitWellbeing = (event) => {
    event.preventDefault();
    perform(() => request('/api/wellbeing', payload({
      ...wellbeingForm,
      learnerId: Number(wellbeingForm.learnerId)
    })), 'Confidential learner support record created.');
    setWellbeingForm({ learnerId: '', category: 'WELLBEING', concern: '' });
  };

  const submitInventory = (event) => {
    event.preventDefault();
    const body = {
      ...inventoryForm,
      quantity: Number(inventoryForm.quantity)
    };
    perform(() => request(inventoryEditId ? `/api/inventory/${inventoryEditId}` : '/api/inventory', {
      method: inventoryEditId ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    }), inventoryEditId ? 'Inventory item updated.' : 'Inventory item added.');
    setInventoryForm({ name: '', category: 'BOOK', identifier: '', location: '', quantity: 1, status: 'ACTIVE' });
    setInventoryEditId(null);
  };

  const checkoutBook = (event) => {
    event.preventDefault();
    perform(
      () => request('/api/library/loans', payload({
        ...loanForm,
        itemId: Number(loanForm.itemId),
        learnerId: Number(loanForm.learnerId)
      })),
      'Book checked out.'
    );
  };

  const download = (path) => perform(() => downloadFile(path, token));

  return (
    <div className="school-tools">
      {error && <p className="status error" role="alert">{error}</p>}

      {section === 'Timetable' && (
        <>
          {['ADMIN', 'TEACHER'].includes(user.role) && (
            <section className="card panel">
              <h3>Add a class timetable entry</h3>
              <form className="form-grid form-grid-three" onSubmit={submitTimetable}>
                <label>Class<select required value={timetableForm.className} onChange={(event) => setTimetableForm({ ...timetableForm, className: event.target.value })}><option value="">Select class</option>{classes.map((item) => <option key={item.className}>{item.className}</option>)}</select></label>
                {user.role === 'ADMIN' && <label>Teacher<select required value={timetableForm.teacherId} onChange={(event) => setTimetableForm({ ...timetableForm, teacherId: event.target.value })}><option value="">Select teacher</option>{teachers.filter((teacher) => teacher.status === 'ACTIVE').map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>}
                <label>Weekday<select value={timetableForm.dayOfWeek} onChange={(event) => setTimetableForm({ ...timetableForm, dayOfWeek: event.target.value })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
                <label>Start time<input required type="time" value={timetableForm.startTime} onChange={(event) => setTimetableForm({ ...timetableForm, startTime: event.target.value })} /></label>
                <label>End time<input required type="time" value={timetableForm.endTime} onChange={(event) => setTimetableForm({ ...timetableForm, endTime: event.target.value })} /></label>
                <label>Subject<input required maxLength="100" value={timetableForm.subject} onChange={(event) => setTimetableForm({ ...timetableForm, subject: event.target.value })} /></label>
                <label>Room (optional)<input maxLength="80" value={timetableForm.room} onChange={(event) => setTimetableForm({ ...timetableForm, room: event.target.value })} /></label>
                <button className="primary" disabled={busy}>Add timetable entry</button>
              </form>
            </section>
          )}
          <section className="card panel">
            <h3>Weekly timetable</h3>
            <div className="table-wrap"><table><thead><tr><th>Day</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th>{['ADMIN', 'TEACHER'].includes(user.role) && <th>Manage</th>}</tr></thead>
              <tbody>{listRecords.map((item) => <tr key={item.id}><td>{weekdays[item.dayOfWeek - 1]}</td><td>{item.startTime}–{item.endTime}</td><td>{item.className}</td><td>{item.subject}</td><td>{item.teacher}</td><td>{item.room || '—'}</td>{['ADMIN', 'TEACHER'].includes(user.role) && <td><button className="secondary small-button" disabled={busy} onClick={() => perform(() => request(`/api/timetable/${item.id}`, { method: 'DELETE' }), 'Timetable entry removed.')}>Remove</button></td>}</tr>)}</tbody>
            </table></div>
            {!listRecords.length && <p className="muted">No timetable entries have been added.</p>}
          </section>
        </>
      )}

      {section === 'LessonPlans' && (
        <>
          {['ADMIN', 'TEACHER'].includes(user.role) && (
            <section className="card panel">
              <h3>Plan a lesson</h3>
              <form className="form-grid form-grid-three" onSubmit={submitLesson}>
                <label>Class<select required value={lessonForm.className} onChange={(event) => setLessonForm({ ...lessonForm, className: event.target.value })}><option value="">Select class</option>{classes.map((item) => <option key={item.className}>{item.className}</option>)}</select></label>
                {user.role === 'ADMIN' && <label>Teacher<select required value={lessonForm.teacherId} onChange={(event) => setLessonForm({ ...lessonForm, teacherId: event.target.value })}><option value="">Select teacher</option>{teachers.filter((teacher) => teacher.status === 'ACTIVE').map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>}
                <label>Date<input type="date" required value={lessonForm.date} onChange={(event) => setLessonForm({ ...lessonForm, date: event.target.value })} /></label>
                <label>Subject<input required value={lessonForm.subject} onChange={(event) => setLessonForm({ ...lessonForm, subject: event.target.value })} /></label>
                <label>Lesson title<input required maxLength="160" value={lessonForm.title} onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })} /></label>
                <label>Learning objectives<textarea rows="2" value={lessonForm.objectives} onChange={(event) => setLessonForm({ ...lessonForm, objectives: event.target.value })} /></label>
                <label>Lesson plan<textarea rows="3" value={lessonForm.plan} onChange={(event) => setLessonForm({ ...lessonForm, plan: event.target.value })} /></label>
                <button className="primary" disabled={busy}>Save lesson plan</button>
              </form>
            </section>
          )}
          <section className="card panel">
            <h3>Lesson plans and progress</h3>
            <div className="table-wrap"><table><thead><tr><th>Date</th><th>Class</th><th>Subject / lesson</th><th>Objectives / plan</th><th>Progress</th><th>Teacher note</th></tr></thead><tbody>
              {listRecords.map((item) => <tr key={item.id}><td>{item.date}</td><td>{item.className}</td><td>{item.subject}<br />{item.title}<br /><span className="muted">{item.teacher}</span></td><td>{item.objectives}<br />{item.plan}</td><td>{['ADMIN', 'TEACHER'].includes(user.role) ? <select aria-label={`Progress for ${item.title}`} value={item.progressStatus} onChange={(event) => perform(() => request(`/api/lesson-plans/${item.id}/progress`, { method: 'PUT', body: JSON.stringify({ progressStatus: event.target.value, progressNote: item.progressNote }) }), 'Lesson progress updated.')}><option>PLANNED</option><option>IN_PROGRESS</option><option>COMPLETED</option></select> : item.progressStatus}</td><td>{['ADMIN', 'TEACHER'].includes(user.role) ? <input aria-label={`Progress note for ${item.title}`} defaultValue={item.progressNote} onBlur={(event) => { if (event.target.value !== item.progressNote) perform(() => request(`/api/lesson-plans/${item.id}/progress`, { method: 'PUT', body: JSON.stringify({ progressStatus: item.progressStatus, progressNote: event.target.value }) }), 'Lesson progress note saved.'); }} /> : item.progressNote || '—'}</td></tr>)}
            </tbody></table></div>
            {!listRecords.length && <p className="muted">No lesson plans are available for your classes.</p>}
          </section>
        </>
      )}

      {section === 'ReportCards' && (
        <>
          <section className="card panel">
            <h3>Create or view a term report</h3>
            <form className="form-grid form-grid-three" onSubmit={loadReport}>
              <label>Learner<select required value={selectedLearner} onChange={(event) => setSelectedLearner(event.target.value)}><option value="">Select learner</option>{learners.filter((learner) => learner.status === 'ACTIVE').map((learner) => <option key={learner.id} value={learner.id}>{learner.name} — {learner.className}</option>)}</select></label>
              <label>Term<input required value={term} onChange={(event) => setTerm(event.target.value)} /></label>
              <label>From<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label>To<input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
              <button className="primary" disabled={busy}>Generate report</button>
            </form>
          </section>
          {report && (
            <section className="card panel print-report">
              <div className="report-heading"><div><p className="eyebrow">Cheleta Primary School</p><h2>Term report — {report.term}</h2><p>{report.learner.name} · Grade {report.learner.grade} · {report.learner.className}</p><p>{report.startDate} to {report.endDate}</p></div><button className="secondary" onClick={() => window.print()}>Print / Save as PDF</button></div>
              <h3>Attendance</h3><p>{report.attendance.rate}% attendance · {report.attendance.attended} present/late · {report.attendance.absent} absent · {report.attendance.late} late · {report.attendance.total} recorded days</p>
              <h3>CBC learning progress</h3>
              <div className="table-wrap"><table><thead><tr><th>Subject</th><th>Strand</th><th>Competency</th><th>Level</th><th>Teacher comment</th></tr></thead><tbody>{report.assessments.map((entry) => <tr key={entry.id}><td>{entry.subject}</td><td>{entry.strand} · {entry.subStrand}</td><td>{entry.competency}</td><td>{entry.level}</td><td>{entry.comment || '—'}<br /><span className="muted">{entry.teacher}</span></td></tr>)}</tbody></table></div>
              {!report.assessments.length && <p className="muted">No CBC assessments were recorded for this term and date range.</p>}
              <h3>Teacher’s term comment</h3>
              <p>{report.teacherComment?.comment || 'No term comment has been added.'}</p>
              {['ADMIN', 'TEACHER'].includes(user.role) ? (
                <form className="form-grid no-print" onSubmit={saveReportComment}>
                  {user.role === 'ADMIN' && <label>Teacher<select required value={reportTeacher} onChange={(event) => setReportTeacher(event.target.value)}><option value="">Select teacher</option>{teachers.filter((teacher) => teacher.status === 'ACTIVE').map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>}
                  <label>Comment<textarea required maxLength="1500" rows="4" value={reportComment} onChange={(event) => setReportComment(event.target.value)} /></label>
                  <button className="primary" disabled={busy}>Save comment and notify parent</button>
                </form>
              ) : null}
            </section>
          )}
        </>
      )}

      {section === 'Notifications' && (
        <>
          {user.role === 'PARENT' && (
            <section className="card panel">
              <h3>SMS alert preferences</h3>
              <p className="muted">Use an international phone number. SMS sending requires the school to configure Africa’s Talking; in-app alerts work independently.</p>
              <form className="form-grid form-grid-three" onSubmit={savePhone}>
                <label>Mobile number<input type="tel" placeholder="+254712345678" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={smsOptIn} onChange={(event) => setSmsOptIn(event.target.checked)} /> Send me school updates by SMS</label>
                <button className="primary" disabled={busy}>Save preferences</button>
              </form>
            </section>
          )}
          {user.role === 'ADMIN' && (
            <section className="card panel">
              <h3>Send a school announcement</h3>
              <form className="form-grid" onSubmit={publishAnnouncement}>
                <label>Title<input required maxLength="160" value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} /></label>
                <label>Message<textarea required maxLength="1200" rows="3" value={announcement.message} onChange={(event) => setAnnouncement({ ...announcement, message: event.target.value })} /></label>
                <label>Priority<select value={announcement.priority} onChange={(event) => setAnnouncement({ ...announcement, priority: event.target.value })}><option>Low</option><option>Normal</option><option>High</option></select></label>
                <button className="primary" disabled={busy}>Publish and notify parents</button>
              </form>
            </section>
          )}
          <section className="card panel">
            <div className="panel-heading"><h3>Your notifications</h3><button className="secondary small-button" disabled={busy} onClick={() => perform(() => request('/api/notifications/read-all', { method: 'PATCH' }), 'Notifications marked as read.')}>Mark all read</button></div>
            {notificationRecords.map((item) => <article className="item-row" key={`notification-${item.id}`}><div><strong>{item.title}</strong><p>{item.message}</p><small>{item.createdAt} · {item.read ? 'Read' : 'Unread'}{item.smsStatus ? ` · SMS: ${item.smsStatus}` : ''}</small></div>{!item.read && <button className="secondary small-button" disabled={busy} onClick={() => perform(() => request(`/api/notifications/${item.id}/read`, { method: 'PATCH' }), 'Notification marked as read.')}>Mark read</button>}</article>)}
            {!notificationRecords.length && <p className="muted">No notifications yet.</p>}
          </section>
          <section className="card panel">
            <h3>School announcements</h3>
            {announcementRecords.map((item) => <article className="item-row" key={`announcement-${item.id}`}><div><strong>{item.title}</strong><p>{item.message}</p></div><span className="level-badge">{item.priority}</span></article>)}
            {!announcementRecords.length && <p className="muted">No announcements available.</p>}
          </section>
        </>
      )}

      {section === 'Wellbeing' && (
        <>
          <section className="card panel privacy-notice"><strong>Confidential learner support records</strong><p>Visible only to administrators and teachers assigned to the learner’s class. Keep notes factual, relevant, and limited to information needed for follow-up.</p></section>
          <section className="card panel">
            <h3>Record a concern</h3>
            <form className="form-grid form-grid-three" onSubmit={submitWellbeing}>
              <label>Learner<select required value={wellbeingForm.learnerId} onChange={(event) => setWellbeingForm({ ...wellbeingForm, learnerId: event.target.value })}><option value="">Select learner</option>{learners.filter((learner) => learner.status === 'ACTIVE').map((learner) => <option key={learner.id} value={learner.id}>{learner.name} — {learner.className}</option>)}</select></label>
              <label>Category<select value={wellbeingForm.category} onChange={(event) => setWellbeingForm({ ...wellbeingForm, category: event.target.value })}><option>WELLBEING</option><option>SAFETY</option><option>LEARNING</option><option>OTHER</option></select></label>
              <label>Concern<textarea required maxLength="2000" rows="3" value={wellbeingForm.concern} onChange={(event) => setWellbeingForm({ ...wellbeingForm, concern: event.target.value })} /></label>
              <button className="primary" disabled={busy}>Save confidential record</button>
            </form>
          </section>
          <section className="card panel">
            <h3>Cases and follow-up</h3>
            {listRecords.map((item) => <article className="wellbeing-record" key={item.id}><div><strong>{item.learner} · {item.className} · {item.category}</strong><p>{item.concern}</p><small>Recorded by {item.reportedBy} · Updated {item.updatedAt}</small></div><label>Status<select value={item.status} onChange={(event) => perform(() => request(`/api/wellbeing/${item.id}`, { method: 'PUT', body: JSON.stringify({ status: event.target.value, followUp: item.followUp }) }), 'Follow-up status updated.')}><option>OPEN</option><option>FOLLOW_UP</option><option>RESOLVED</option></select></label><label>Follow-up<textarea rows="2" defaultValue={item.followUp} onBlur={(event) => { if (event.target.value !== item.followUp) perform(() => request(`/api/wellbeing/${item.id}`, { method: 'PUT', body: JSON.stringify({ status: item.status, followUp: event.target.value }) }), 'Follow-up note saved.'); }} /></label></article>)}
            {!listRecords.length && <p className="muted">No support cases are available for your assigned learners.</p>}
          </section>
        </>
      )}

      {section === 'Library' && (
        <>
          {['ADMIN', 'STAFF'].includes(user.role) && (
            <>
              <section className="card panel">
                <h3>{inventoryEditId ? 'Update inventory item' : 'Add a book or inventory item'}</h3>
                <form className="form-grid form-grid-three" onSubmit={submitInventory}>
                  <label>Name<input required maxLength="160" value={inventoryForm.name} onChange={(event) => setInventoryForm({ ...inventoryForm, name: event.target.value })} /></label>
                  <label>Category<select value={inventoryForm.category} onChange={(event) => setInventoryForm({ ...inventoryForm, category: event.target.value })}><option value="BOOK">Book</option><option value="SUPPLY">Classroom supply</option><option value="EQUIPMENT">Equipment</option></select></label>
                  <label>Identifier<input value={inventoryForm.identifier} onChange={(event) => setInventoryForm({ ...inventoryForm, identifier: event.target.value })} /></label>
                  <label>Location<input value={inventoryForm.location} onChange={(event) => setInventoryForm({ ...inventoryForm, location: event.target.value })} /></label>
                  <label>Quantity<input type="number" min="0" max="100000" required value={inventoryForm.quantity} onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: event.target.value })} /></label>
                  {inventoryEditId && <label>Status<select value={inventoryForm.status} onChange={(event) => setInventoryForm({ ...inventoryForm, status: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label>}
                  <div className="form-actions"><button className="primary" disabled={busy}>{inventoryEditId ? 'Save item' : 'Add item'}</button>{inventoryEditId && <button type="button" className="secondary" onClick={() => { setInventoryEditId(null); setInventoryForm({ name: '', category: 'BOOK', identifier: '', location: '', quantity: 1, status: 'ACTIVE' }); }}>Cancel</button>}</div>
                </form>
              </section>
              <section className="card panel">
                <h3>Issue a library book</h3>
                <form className="form-grid form-grid-three" onSubmit={checkoutBook}>
                  <label>Book<select required value={loanForm.itemId} onChange={(event) => setLoanForm({ ...loanForm, itemId: event.target.value })}><option value="">Select available book</option>{records.items?.filter((item) => item.category === 'BOOK' && item.availableCount > 0 && item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.name} ({item.availableCount} available)</option>)}</select></label>
                  <label>Learner<select required value={loanForm.learnerId} onChange={(event) => setLoanForm({ ...loanForm, learnerId: event.target.value })}><option value="">Select learner</option>{learners.filter((learner) => learner.status === 'ACTIVE').map((learner) => <option key={learner.id} value={learner.id}>{learner.name} — {learner.className}</option>)}</select></label>
                  <label>Checkout date<input type="date" required value={loanForm.checkoutDate} onChange={(event) => setLoanForm({ ...loanForm, checkoutDate: event.target.value })} /></label>
                  <label>Due date<input type="date" required value={loanForm.dueDate} onChange={(event) => setLoanForm({ ...loanForm, dueDate: event.target.value })} /></label>
                  <button className="primary" disabled={busy}>Check out book</button>
                </form>
              </section>
            </>
          )}
          {['ADMIN', 'STAFF', 'TEACHER'].includes(user.role) && (
            <section className="card panel">
              <h3>Books, supplies, and equipment</h3>
              <div className="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Identifier</th><th>Location</th><th>Available / total</th><th>Status</th>{['ADMIN', 'STAFF'].includes(user.role) && <th>Manage</th>}</tr></thead><tbody>{records.items?.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{item.identifier || '—'}</td><td>{item.location || '—'}</td><td>{item.availableCount} / {item.quantity}</td><td>{item.status}</td>{['ADMIN', 'STAFF'].includes(user.role) && <td><button className="secondary small-button" onClick={() => { setInventoryForm({ name: item.name, category: item.category, identifier: item.identifier, location: item.location, quantity: item.quantity, status: item.status }); setInventoryEditId(item.id); }}>Edit</button></td>}</tr>)}</tbody></table></div>
              {!records.items?.length && <p className="muted">No library or inventory items have been added.</p>}
            </section>
          )}
          <section className="card panel">
            <h3>Library loans</h3>
            <div className="table-wrap"><table><thead><tr><th>Book</th><th>Learner</th><th>Class</th><th>Checked out</th><th>Due</th><th>Status</th>{['ADMIN', 'STAFF'].includes(user.role) && <th>Manage</th>}</tr></thead><tbody>{records.loans?.map((loan) => <tr key={loan.id}><td>{loan.item}</td><td>{loan.learner}</td><td>{loan.className}</td><td>{loan.checkoutDate}</td><td>{loan.dueDate}</td><td>{loan.returnedAt ? 'Returned' : loan.dueDate < currentDate() ? 'Overdue' : 'On loan'}</td>{['ADMIN', 'STAFF'].includes(user.role) && <td>{!loan.returnedAt && <button className="secondary small-button" disabled={busy} onClick={() => perform(() => request(`/api/library/loans/${loan.id}/return`, { method: 'PUT' }), 'Book return recorded.')}>Mark returned</button>}</td>}</tr>)}</tbody></table></div>
            {!records.loans?.length && <p className="muted">No book loans are recorded.</p>}
          </section>
        </>
      )}

      {section === 'AdminReports' && analytics && (
        <>
          <section className="card panel">
            <div className="panel-heading"><div><h3>School follow-up reports</h3><p className="muted">Learners with attendance below 85% (at least three records) or one or more BE-level assessments are listed for review.</p></div><label>Period<select value={days} onChange={(event) => setDays(event.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 180 days</option><option value="365">Last year</option></select></label></div>
          </section>
          <section className="card panel">
            <h3>Attendance patterns</h3>
            <div className="table-wrap"><table><thead><tr><th>Date</th><th>Recorded</th><th>Attendance rate</th></tr></thead><tbody>{analytics.attendanceTrend.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.total}</td><td>{row.rate ?? 0}%</td></tr>)}</tbody></table></div>
            {!analytics.attendanceTrend.length && <p className="muted">No attendance records in this period.</p>}
          </section>
          <section className="card panel">
            <h3>Learners needing follow-up <span className="count-badge">{analytics.followUp.length}</span></h3>
            <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Attendance rate</th><th>Absences</th><th>BE assessments</th></tr></thead><tbody>{analytics.followUp.map((row) => <tr key={row.learnerId}><td>{row.learner}</td><td>{row.className}</td><td>{row.attendanceRate}%</td><td>{row.absences || 0}</td><td>{row.beginningLevels}</td></tr>)}</tbody></table></div>
            {!analytics.followUp.length && <p className="muted">No learners currently meet these follow-up indicators.</p>}
          </section>
          <section className="card panel">
            <h3>Class-level progress</h3>
            <div className="table-wrap"><table><thead><tr><th>Class</th><th>Learners</th><th>Attendance rate</th><th>Assessments</th><th>BE levels</th></tr></thead><tbody>{analytics.byClass.map((row) => <tr key={row.className}><td>{row.className}</td><td>{row.learners}</td><td>{row.attendanceRate}%</td><td>{row.assessments}</td><td>{row.beginningLevels || 0}</td></tr>)}</tbody></table></div>
          </section>
          <section className="card panel">
            <h3>CBC progress by class and term</h3>
            <div className="table-wrap"><table><thead><tr><th>Class</th><th>Term</th><th>Assessments</th><th>EE</th><th>ME</th><th>AE</th><th>BE</th></tr></thead><tbody>{analytics.progressByTerm.map((row) => <tr key={`${row.className}-${row.term}`}><td>{row.className}</td><td>{row.term}</td><td>{row.assessments}</td><td>{row.exceeds}</td><td>{row.meets}</td><td>{row.approaching}</td><td>{row.beginning}</td></tr>)}</tbody></table></div>
            {!analytics.progressByTerm.length && <p className="muted">No CBC assessments in this reporting period.</p>}
          </section>
        </>
      )}

      {section === 'Exports' && (
        <section className="card panel">
          <h3>Export records you are authorized to view</h3>
          <p className="muted">CSV files open in spreadsheet software. Parent and student exports contain only linked learner records; teacher exports are limited to assigned classes.</p>
          <div className="form-actions">
            {['learners', 'attendance', 'assessments'].map((type) => <button key={type} className="secondary" disabled={busy} onClick={() => download(`/api/exports/${type}.csv`)}>Download {type}</button>)}
          </div>
        </section>
      )}

      {section === 'Backups' && (
        <section className="card panel">
          <h3>Download a database backup</h3>
          <p>A backup contains sensitive school information, including confidential learner support records. Store the file securely and share it only with authorized school administrators.</p>
          <button className="primary" disabled={busy} onClick={() => download('/api/admin/backup')}>Download SQLite backup</button>
        </section>
      )}
    </div>
  );
}
