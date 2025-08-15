# Task Manager Backend (RBAC: Admin, Manager, Employee)

Features:
- JWT auth, hashed passwords (bcrypt)
- Role-based access control (Admin, Manager, Employee)
- Admin assigns tasks to Managers & Employees
- Manager assigns tasks to Employees
- Employees can only update status of their own tasks
- Task CRUD with reassignment & history

## Run locally
```bash
cp .env.example .env
npm i
npm run dev
```

Then seed the first admin **once**:
```
POST http://localhost:4000/auth/seed-admin
```

Login:
```
POST http://localhost:4000/auth/login
{ "email": "admin@example.com", "password": "Admin@123" }
```

Use the `token` from login as `Authorization: Bearer <token>` for the routes below.

### Key routes
- **Create user (Admin)**: `POST /auth/register` (name, email, password, role: ADMIN|MANAGER|EMPLOYEE)
- **List users**: `GET /users?role=EMPLOYEE`
- **Create task (Admin/Manager)**: `POST /tasks` (title, assignedTo, description?, priority?, dueDate?)
- **List tasks (scoped)**: `GET /tasks?page=1&limit=10&status=TODO&priority=HIGH`
- **Update task**: `PATCH /tasks/:id` (Employee can only update `status` on own tasks)
- **Reassign (Admin/Manager)**: `PATCH /tasks/:id/assign` (assignedTo)
- **Delete (Admin)**: `DELETE /tasks/:id`
