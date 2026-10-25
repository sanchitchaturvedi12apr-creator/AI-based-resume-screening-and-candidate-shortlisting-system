// Temporary UI preview fixtures. These records are held in browser memory and are not stored in MySQL.
export const jobs = [
  { id: 'JOB-1048', title: 'Senior Product Designer', department: 'Design', location: 'New York, NY', type: 'Full-time', status: 'Active', applicants: 48, posted: '2 days ago', skills: ['Figma', 'Design systems', 'Prototyping', 'User research'], description: 'Lead end-to-end product design across a growing suite of workflow tools.' },
  { id: 'JOB-1047', title: 'Frontend Engineer', department: 'Engineering', location: 'Remote', type: 'Full-time', status: 'Active', applicants: 36, posted: '4 days ago', skills: ['React', 'TypeScript', 'Accessibility', 'CSS'], description: 'Build thoughtful, accessible interfaces for our customer-facing products.' },
  { id: 'JOB-1046', title: 'People Operations Partner', department: 'People', location: 'Austin, TX', type: 'Full-time', status: 'Active', applicants: 21, posted: '1 week ago', skills: ['Employee relations', 'HRIS', 'Analytics'], description: 'Help us create a supportive, high-performing workplace.' },
  { id: 'JOB-1045', title: 'Data Analyst', department: 'Analytics', location: 'Remote', type: 'Contract', status: 'Paused', applicants: 62, posted: '2 weeks ago', skills: ['SQL', 'Python', 'Tableau', 'Experimentation'], description: 'Turn product data into clear insights and decisions.' },
]
export const candidates = [
  { id: 'CAN-2081', name: 'Olivia Rhye', email: 'olivia.rhye@email.com', role: 'Product Designer', location: 'New York, NY', experience: '8 years', skills: ['Figma', 'Design systems', 'Prototyping'], applied: 'Today', status: 'Shortlisted', initials: 'OR', color: 'violet' },
  { id: 'CAN-2080', name: 'Phoenix Baker', email: 'phoenix.baker@email.com', role: 'Frontend Engineer', location: 'San Francisco, CA', experience: '6 years', skills: ['React', 'TypeScript', 'CSS'], applied: 'Today', status: 'Reviewing', initials: 'PB', color: 'blue' },
  { id: 'CAN-2079', name: 'Lana Steiner', email: 'lana.steiner@email.com', role: 'Product Designer', location: 'Brooklyn, NY', experience: '5 years', skills: ['Figma', 'User research', 'Prototyping'], applied: 'Yesterday', status: 'New', initials: 'LS', color: 'rose' },
  { id: 'CAN-2078', name: 'Demi Wilkinson', email: 'demi.wilkinson@email.com', role: 'Data Analyst', location: 'Austin, TX', experience: '4 years', skills: ['SQL', 'Python', 'Tableau'], applied: 'Yesterday', status: 'Reviewing', initials: 'DW', color: 'amber' },
  { id: 'CAN-2077', name: 'Candice Wu', email: 'candice.wu@email.com', role: 'Frontend Engineer', location: 'Remote', experience: '7 years', skills: ['React', 'Accessibility', 'CSS'], applied: '2 days ago', status: 'Shortlisted', initials: 'CW', color: 'teal' },
  { id: 'CAN-2076', name: 'Natali Craig', email: 'natali.craig@email.com', role: 'Product Designer', location: 'New York, NY', experience: '3 years', skills: ['Figma', 'Design systems'], applied: '2 days ago', status: 'New', initials: 'NC', color: 'indigo' },
]
export const matches = [
  { candidate: candidates[0], job: 'Senior Product Designer', score: 96, matched: ['Figma', 'Design systems', 'Prototyping'], missing: ['Motion design'], status: 'Shortlisted' },
  { candidate: candidates[2], job: 'Senior Product Designer', score: 88, matched: ['Figma', 'User research', 'Prototyping'], missing: ['Design systems'], status: 'Reviewing' },
  { candidate: candidates[4], job: 'Frontend Engineer', score: 91, matched: ['React', 'Accessibility', 'CSS'], missing: ['TypeScript'], status: 'Shortlisted' },
  { candidate: candidates[1], job: 'Frontend Engineer', score: 84, matched: ['React', 'TypeScript', 'CSS'], missing: ['Accessibility'], status: 'New' },
  { candidate: candidates[3], job: 'Data Analyst', score: 79, matched: ['SQL', 'Python'], missing: ['Experimentation'], status: 'Reviewing' },
]
export const activity = [
  { text: 'Olivia Rhye was shortlisted for', item: 'Senior Product Designer', time: '12 min ago', icon: 'check' },
  { text: 'New application from Phoenix Baker for', item: 'Frontend Engineer', time: '1 hour ago', icon: 'user' },
  { text: 'You published a new job:', item: 'People Operations Partner', time: 'Yesterday', icon: 'briefcase' },
  { text: 'Lana Steiner uploaded a resume for', item: 'Senior Product Designer', time: 'Yesterday', icon: 'file' },
]
