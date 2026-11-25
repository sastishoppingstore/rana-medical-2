-- Safe starter reference data only. All names/fees are illustrative.
-- No patient records, passwords or real employee credentials are seeded.
BEGIN;
INSERT INTO roles(name,description) VALUES
('Super Admin','Demo role; production privileges must be reviewed'),('Doctor','Clinical care role'),('Receptionist','Appointments and patient registration'),('Lab Technician','Lab workflow role'),('Pharmacist','Pharmacy workflow role'),('Accountant','Financial workflow role') ON CONFLICT(name) DO NOTHING;
INSERT INTO permissions(code,description) VALUES
('appointments.read','View appointment queues'),('appointments.write','Create and update appointments'),('patients.read','Access authorized patient data'),('patients.write','Register and update patient records'),('clinical.write','Create clinical notes and prescriptions'),('lab.write','Enter laboratory results'),('lab.publish','Authorize and publish laboratory reports'),('pharmacy.write','Dispense and manage medicine stock'),('finance.read','View accounts and reports'),('finance.write','Post payments and expenses'),('hr.write','Manage employee and payroll records'),('cms.write','Manage public website content'),('audit.read','Read security audit events'),('settings.write','Manage system settings') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='Super Admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('appointments.read','patients.read','clinical.write') WHERE r.name='Doctor' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('appointments.read','appointments.write','patients.write') WHERE r.name='Receptionist' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('patients.read','lab.write','lab.publish') WHERE r.name='Lab Technician' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('patients.read','pharmacy.write') WHERE r.name='Pharmacist' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('finance.read','finance.write') WHERE r.name='Accountant' ON CONFLICT DO NOTHING;
INSERT INTO departments(name) VALUES ('Medicine'),('Surgery'),('Gynecology'),('Pediatrics'),('Cardiology'),('Orthopedics'),('Dental Care'),('Physiotherapy') ON CONFLICT(name) DO NOTHING;
INSERT INTO lab_tests(code,name,description,price_paisa,turnaround_hours) VALUES
('DEMO-CBC','Complete Blood Count','Illustrative demo catalog item',120000,12),('DEMO-FBG','Fasting Blood Glucose','Illustrative demo catalog item',50000,8),('DEMO-LIPID','Lipid Profile','Illustrative demo catalog item',200000,18),('DEMO-THYROID','Thyroid Profile','Illustrative demo catalog item',250000,24) ON CONFLICT(code) DO NOTHING;
INSERT INTO packages(name,description,price_paisa,inclusions,published) VALUES
('Executive Full Body Checkup','Illustrative only; confirm with hospital',850000,'["CBC","Lipid profile","Liver and renal panels","Physician consultation"]',false),
('Diabetes Care Package','Illustrative only; confirm with hospital',420000,'["Glucose and HbA1c","Renal profile","Dietitian consultation"]',false),
('Basic Health Screening','Illustrative only; confirm with hospital',350000,'["CBC","Glucose","Urine analysis"]',false) ON CONFLICT DO NOTHING;
COMMIT;
-- Provision individual accounts through a secure identity workflow. Never set a shared demo password here.
