-- Default categories (not personal data). Colours for time categories come from the original Excel sheet.

INSERT INTO time_categories (name_th, name_en, color, sort) VALUES
  ('พักผ่อน',        'Rest',         '#C1E6FF', 1),
  ('ทำงาน',          'Work',         '#C4ECD0', 2),
  ('project เสริม',  'Side project', '#E7DEF8', 3),
  ('ฝึกฝน',          'Practice',     '#FFE6A4', 4),
  ('กิจวัตร/อื่นๆ',   'Routine',      '#FAE7E5', 5);

INSERT INTO course_categories (name_th, name_en, icon, tint, sort) VALUES
  ('ภาษา',              'Languages',         'speech',  'r', 1),
  ('ดนตรี',             'Music',             'music',   'f', 2),
  ('ศิลปะ/วาดรูป',       'Art & drawing',     'brush',   'o', 3),
  ('IT/โปรแกรม',        'IT & programming',  'code',    'w', 4),
  ('คณิต',              'Math',              'sigma',   'p', 5),
  ('วิทยาศาสตร์',        'Science',           'flask',   'r', 6),
  ('ออกกำลังกาย/สุขภาพ', 'Fitness & health',  'heart',   'w', 7),
  ('ทำอาหาร',           'Cooking',           'chef',    'o', 8),
  ('การเงิน',           'Finance',           'coin',    'f', 9),
  ('ธุรกิจ/การตลาด',     'Business',          'chart',   'p', 10),
  ('ถ่ายภาพ/วิดีโอ',      'Photo & video',     'camera',  'r', 11),
  ('ทำเกม',             'Game dev',          'gamepad', 'p', 12),
  ('พัฒนาตัวเอง',        'Self-growth',       'sprout',  'w', 13);
