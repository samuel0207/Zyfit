import sys
import os
# Dynamically add backend and app directories to sys.path to ensure correct module resolution on Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import date, datetime, timedelta
from typing import List, Optional

from app.config import settings
from app.database import engine, Base, get_db
from app import models, schemas, auth

# Auto-create tables safely on startup
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"[Startup Warning] Could not auto-create tables: {e}")

# Auto-migrate: Add columns safely for both SQLite and PostgreSQL
from sqlalchemy import text, inspect as sa_inspect

def safe_migrate():
    """Run migrations that are safe for both SQLite and PostgreSQL."""
    try:
        inspector = sa_inspect(engine)
        
        # Check if 'workouts' table exists before migrating
        if inspector.has_table('workouts'):
            existing_cols = [col['name'] for col in inspector.get_columns('workouts')]
            if 'days_of_week' not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE workouts ADD COLUMN days_of_week VARCHAR(150);"))
            if 'start_date' not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE workouts ADD COLUMN start_date DATE;"))
            if 'end_date' not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE workouts ADD COLUMN end_date DATE;"))
        
        # Check if 'users' table exists before migrating
        if inspector.has_table('users'):
            existing_user_cols = [col['name'] for col in inspector.get_columns('users')]
            
            # Rename email -> phone only if email exists and phone doesn't
            if 'email' in existing_user_cols and 'phone' not in existing_user_cols:
                with engine.begin() as conn:
                    if settings.DATABASE_URL.startswith('sqlite'):
                        conn.execute(text("ALTER TABLE users RENAME COLUMN email TO phone;"))
                    else:
                        conn.execute(text("ALTER TABLE users RENAME COLUMN email TO phone;"))
            
            # Add password column if it doesn't exist
            if 'password' not in existing_user_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN password VARCHAR(100);"))
            
            # Add age column if it doesn't exist
            if 'age' not in existing_user_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN age INTEGER;"))

            # Add goal_date column if it doesn't exist
            if 'goal_date' not in existing_user_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE users ADD COLUMN goal_date DATE;"))
        
        # Widen exercises.name column from VARCHAR(100) to VARCHAR(500)
        if inspector.has_table('exercises'):
            with engine.begin() as conn:
                if not settings.DATABASE_URL.startswith('sqlite'):
                    conn.execute(text("ALTER TABLE exercises ALTER COLUMN name TYPE VARCHAR(500);"))
    except Exception as e:
        print(f"[Migration Warning] Non-critical migration error: {e}")

try:
    safe_migrate()
except Exception as e:
    print(f"[Startup Warning] safe_migrate failed: {e}")


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API REST de Gestão de Treinos Físicos para Professores e Alunos",
    version="1.0.0"
)

# Global exception handler to always return JSON (prevents "Internal Server Error" as plain text)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    print(f"[ERROR] Unhandled exception on {request.url}: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Erro interno do servidor: {str(exc)}"}
    )

# Configure CORS so any local/mobile frontend can connect to our api
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed default database values on startup (create default PE Teacher admin)
@app.on_event("startup")
def seed_data():
    db = next(get_db())
    try:
        # Check if any admin exists, if not create one
        admin = db.query(models.User).filter(models.User.role == "admin").first()
        if not admin:
            admin_user = models.User(
                name="Professora Maria (Admin)",
                phone="153624zyfit22",
                password_hash=auth.get_password_hash("153624zyfit22"),
                password="153624zyfit22",
                role="admin"
            )
            db.add(admin_user)
            db.commit()
            print("\n" + "="*50)
            print("SEED DATABASE: Usuário Admin padrão criado com sucesso!")
            print("Celular/Login: 153624zyfit22")
            print("Senha: 153624zyfit22")
            print("="*50 + "\n")
        else:
            # Upgrade or synchronize existing admin to match database password credentials
            admin.phone = "153624zyfit22"
            admin.password = "153624zyfit22"
            admin.password_hash = auth.get_password_hash("153624zyfit22")
            db.commit()
    except Exception as e:
        print(f"Erro ao executar seeding inicial: {e}")
    finally:
        db.close()


# -------------------------------------------------------------
# 1. MÓDULO DE AUTENTICAÇÃO
# -------------------------------------------------------------

@app.post("/api/auth/login", response_model=schemas.Token)
def login(
    payload: schemas.UserCreate,  # Direct JSON support for easy Frontend usage
    db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(models.User.phone == payload.phone).first()
    if not user or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telefone celular ou senha incorretos.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = auth.create_access_token(
        data={"sub": user.phone, "role": user.role}
    )
    return {"access_token": access_token, "token_type": "bearer"}

# Overload login route specifically to support FastAPI's native /docs Swagger OAuth2 UI
@app.post("/api/auth/swagger-login", include_in_schema=False)
def login_swagger(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(models.User.phone == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telefone celular ou senha incorretos.",
        )
    access_token = auth.create_access_token(
        data={"sub": user.phone, "role": user.role}
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


# -------------------------------------------------------------
# 2. GESTÃO DE ALUNOS (Apenas Admin)
# -------------------------------------------------------------

@app.get("/api/students", response_model=List[schemas.UserResponse])
def list_students(
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    query = db.query(models.User).filter(models.User.role == "student")
    if q:
        query = query.filter(
            (models.User.name.ilike(f"%{q}%")) | 
            (models.User.phone.ilike(f"%{q}%"))
        )
    return query.all()


@app.post("/api/students", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def create_student(
    student_in: schemas.UserCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    # Verify phone uniqueness
    existing_user = db.query(models.User).filter(models.User.phone == student_in.phone).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este número de celular já está sendo utilizado."
        )
    
    hashed_password = auth.get_password_hash(student_in.password)
    student = models.User(
        name=student_in.name,
        phone=student_in.phone,
        password_hash=hashed_password,
        password=student_in.password,
        role="student",
        age=student_in.age,
        weight=student_in.weight,
        height=student_in.height,
        goals=student_in.goals,
        goal_date=student_in.goal_date
    )
    
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


@app.get("/api/students/{student_id}", response_model=schemas.UserResponse)
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    student = db.query(models.User).filter(models.User.id == student_id, models.User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Estudante não encontrado.")
    return student


@app.put("/api/students/{student_id}", response_model=schemas.UserResponse)
def update_student(
    student_id: str,
    student_in: schemas.UserUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    student = db.query(models.User).filter(models.User.id == student_id, models.User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Estudante não encontrado.")
    
    # Update properties
    update_data = student_in.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        student.password_hash = auth.get_password_hash(update_data["password"])
        student.password = update_data["password"]
        del update_data["password"]
        
    for key, value in update_data.items():
        setattr(student, key, value)
        
    db.commit()
    db.refresh(student)
    return student


@app.delete("/api/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    student = db.query(models.User).filter(models.User.id == student_id, models.User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Estudante não encontrado.")
    
    db.delete(student)
    db.commit()
    return None


# -------------------------------------------------------------
# 3. GESTÃO DE TREINOS (FICHAS) (Apenas Admin)
# -------------------------------------------------------------

def compute_workout_status(workout: models.Workout):
    """Calcula o status do prazo da ficha e os dias restantes."""
    if not workout.end_date:
        return "no_deadline", None
    
    today = date.today()
    days_left = (workout.end_date - today).days
    
    if days_left < 0:
        return "expired", days_left
    elif days_left == 0:
        return "expiring_today", 0
    elif days_left <= 3:
        return "expiring_soon", days_left
    else:
        return "active", days_left

def attach_workout_status(w: models.Workout):
    """Anexa status e days_remaining ao objeto do workout para serialização Pydantic."""
    s, d = compute_workout_status(w)
    setattr(w, "status", s)
    setattr(w, "days_remaining", d)
    return w


def check_and_create_workout_notifications(db: Session, user_id: str):
    """
    Verifica se o aluno possui treinos com prazo encerrado ou encerrando hoje/em breve,
    e gera notificações no sistema automaticamente (evitando duplicatas).
    """
    workouts = db.query(models.Workout).filter(
        models.Workout.student_id == user_id,
        models.Workout.end_date != None
    ).all()

    created_any = False
    for w in workouts:
        status_str, days_left = compute_workout_status(w)
        end_date_fmt = w.end_date.strftime("%d/%m/%Y")

        if status_str == "expired":
            # Checa se já existe notificação de expiração para este treino
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.workout_id == w.id,
                models.Notification.type == "workout_expired"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=w.id,
                    title="⚠️ Ficha de Treino Vencida!",
                    message=f"O prazo da sua ficha \"{w.title}\" encerrou em {end_date_fmt}. Fale com seu professor para agendar sua reavaliação e renovar seu treino.",
                    type="workout_expired",
                    is_read=False
                )
                db.add(notif)
                created_any = True

        elif status_str == "expiring_today":
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.workout_id == w.id,
                models.Notification.type == "workout_deadline"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=w.id,
                    title="🔔 Prazo do Treino Termina Hoje!",
                    message=f"Atenção: A validade da sua ficha \"{w.title}\" encerra hoje ({end_date_fmt}). Avise seu treinador para preparar sua próxima fase!",
                    type="workout_deadline",
                    is_read=False
                )
                db.add(notif)
                created_any = True

        elif status_str == "expiring_soon" and days_left is not None and days_left > 0:
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.workout_id == w.id,
                models.Notification.type == "workout_expiring_soon"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=w.id,
                    title="⏳ Seu Treino Vence em Breve",
                    message=f"Faltam {days_left} dia(s) para o término da ficha \"{w.title}\" (vence em {end_date_fmt}). Foco nos treinos!",
                    type="workout_expiring_soon",
                    is_read=False
                )
                db.add(notif)
                created_any = True

    # Checa também prazos da Data Meta do Aluno
    student_user = db.query(models.User).filter(models.User.id == user_id).first()
    if student_user and student_user.goal_date:
        today = date.today()
        g_diff = (student_user.goal_date - today).days
        g_date_fmt = student_user.goal_date.strftime("%d/%m/%Y")
        
        if g_diff < 0:
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.type == "goal_date_expired"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=None,
                    title="🎯 Data Meta Vencida!",
                    message=f"Sua data meta de acompanhamento encerrou em {g_date_fmt}. Fale com seu treinador para agendar sua reavaliação!",
                    type="goal_date_expired",
                    is_read=False
                )
                db.add(notif)
                created_any = True
        elif g_diff == 0:
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.type == "goal_date_today"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=None,
                    title="🎯 Sua Meta é Hoje!",
                    message=f"Hoje ({g_date_fmt}) é o dia da sua data meta / reavaliação! Fale com seu professor para registrar seus resultados.",
                    type="goal_date_today",
                    is_read=False
                )
                db.add(notif)
                created_any = True
        elif g_diff <= 3 and g_diff > 0:
            existing = db.query(models.Notification).filter(
                models.Notification.user_id == user_id,
                models.Notification.type == "goal_date_soon"
            ).first()
            if not existing:
                notif = models.Notification(
                    user_id=user_id,
                    workout_id=None,
                    title="🎯 Sua Meta Está Próxima!",
                    message=f"Faltam {g_diff} dia(s) para sua data meta ({g_date_fmt}). Mantenha o foco!",
                    type="goal_date_soon",
                    is_read=False
                )
                db.add(notif)
                created_any = True

    if created_any:
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[Notification Error] Erro ao salvar notificações: {e}")


@app.post("/api/workouts", response_model=schemas.WorkoutResponse, status_code=status.HTTP_201_CREATED)
def create_workout(
    workout_in: schemas.WorkoutCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    # Verify student exists
    student = db.query(models.User).filter(models.User.id == workout_in.student_id, models.User.role == "student").first()
    if not student:
        raise HTTPException(status_code=400, detail="Aluno fornecido não existe.")
        
    workout = models.Workout(
        student_id=workout_in.student_id,
        title=workout_in.title,
        description=workout_in.description,
        days_of_week=workout_in.days_of_week,
        start_date=workout_in.start_date,
        end_date=workout_in.end_date
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return attach_workout_status(workout)


@app.get("/api/workouts/student/{student_id}", response_model=List[schemas.WorkoutResponse])
def get_workouts_by_student(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    # Ensure current user is either the admin or the student themselves
    if current_user.role != "admin" and current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Sem permissão para visualizar estes treinos.")
        
    workouts = db.query(models.Workout).filter(models.Workout.student_id == student_id).all()
    for w in workouts:
        attach_workout_status(w)
    return workouts


@app.get("/api/workouts/{workout_id}", response_model=schemas.WorkoutResponse)
def get_workout_by_id(
    workout_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    workout = db.query(models.Workout).filter(models.Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Ficha de treino não encontrada.")
        
    # Security check
    if current_user.role != "admin" and current_user.id != workout.student_id:
        raise HTTPException(status_code=403, detail="Acesso negado.")
        
    return attach_workout_status(workout)


@app.put("/api/workouts/{workout_id}", response_model=schemas.WorkoutResponse)
def update_workout(
    workout_id: str,
    workout_in: schemas.WorkoutUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    workout = db.query(models.Workout).filter(models.Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Ficha de treino não encontrada.")
        
    update_data = workout_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(workout, key, value)
        
    db.commit()
    db.refresh(workout)
    return attach_workout_status(workout)


@app.delete("/api/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(
    workout_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    workout = db.query(models.Workout).filter(models.Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Ficha de treino não encontrada.")
        
    db.delete(workout)
    db.commit()
    return None


# -------------------------------------------------------------
# 4. GESTÃO DE EXERCÍCIOS (Apenas Admin)
# -------------------------------------------------------------

@app.post("/api/exercises", response_model=schemas.ExerciseResponse, status_code=status.HTTP_201_CREATED)
def create_exercise(
    exercise_in: schemas.ExerciseCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    # Verify workout exists
    workout = db.query(models.Workout).filter(models.Workout.id == exercise_in.workout_id).first()
    if not workout:
        raise HTTPException(status_code=400, detail="A Ficha de treino fornecida não existe.")
        
    exercise = models.Exercise(
        workout_id=exercise_in.workout_id,
        name=exercise_in.name,
        sets=exercise_in.sets,
        repetitions=exercise_in.repetitions,
        rest_time=exercise_in.rest_time,
        video_url=exercise_in.video_url,
        order_index=exercise_in.order_index
    )
    db.add(exercise)
    db.commit()
    db.refresh(exercise)
    return exercise


@app.put("/api/exercises/{exercise_id}", response_model=schemas.ExerciseResponse)
def update_exercise(
    exercise_id: str,
    exercise_in: schemas.ExerciseUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    exercise = db.query(models.Exercise).filter(models.Exercise.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercício não encontrado.")
        
    update_data = exercise_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(exercise, key, value)
        
    db.commit()
    db.refresh(exercise)
    return exercise


@app.delete("/api/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(
    exercise_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    exercise = db.query(models.Exercise).filter(models.Exercise.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercício não encontrado.")
        
    db.delete(exercise)
    db.commit()
    return None


@app.post("/api/exercises/reorder")
def reorder_exercises(
    workout_id: str,
    ordered_ids: List[str],
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    workout = db.query(models.Workout).filter(models.Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Treino não encontrado.")
        
    # Fast reordering index map
    for index, exercise_id in enumerate(ordered_ids):
        exercise = db.query(models.Exercise).filter(
            models.Exercise.id == exercise_id, 
            models.Exercise.workout_id == workout_id
        ).first()
        if exercise:
            exercise.order_index = index
            
    db.commit()
    return {"message": "Reordenação concluída com sucesso!"}


# -------------------------------------------------------------
# 5. PORTAL DO ALUNO (Visualização e Conclusões)
# -------------------------------------------------------------

@app.get("/api/student-portal/my-workouts", response_model=List[schemas.WorkoutStudentResponse])
def get_my_workouts_portal(
    db: Session = Depends(get_db),
    student: models.User = Depends(auth.get_current_user)
):
    if student.role != "student":
        # If Admin views portals, let them view all student's portals or throw (here we restrict to current student context)
        raise HTTPException(status_code=403, detail="O portal é exclusivo para contas de alunos.")

    # Verifica e gera notificações de prazos automaticamente
    check_and_create_workout_notifications(db, student.id)

    # Fetch workouts
    workouts = db.query(models.Workout).filter(models.Workout.student_id == student.id).all()
    
    # Get completions for today
    today = date.today()
    completed_exercise_ids = set(
        row.exercise_id for row in db.query(models.ExerciseCompletion.exercise_id)
        .filter(
            models.ExerciseCompletion.student_id == student.id,
            models.ExerciseCompletion.completed_date == today
        ).all()
    )

    # Reconstruct custom response adding completed_today dynamically
    workouts_portal = []
    for w in workouts:
        exercises_portal = []
        for ex in w.exercises:
            exercises_portal.append(
                schemas.ExerciseStudentResponse(
                    id=ex.id,
                    workout_id=ex.workout_id,
                    name=ex.name,
                    sets=ex.sets,
                    repetitions=ex.repetitions,
                    rest_time=ex.rest_time,
                    video_url=ex.video_url,
                    order_index=ex.order_index,
                    completed_today=(ex.id in completed_exercise_ids)
                )
            )
            
        status_str, days_left = compute_workout_status(w)
        workouts_portal.append(
            schemas.WorkoutStudentResponse(
                id=w.id,
                student_id=w.student_id,
                title=w.title,
                description=w.description,
                days_of_week=w.days_of_week,
                start_date=w.start_date,
                end_date=w.end_date,
                status=status_str,
                days_remaining=days_left,
                created_at=w.created_at,
                updated_at=w.updated_at,
                exercises=exercises_portal
            )
        )
        
    return workouts_portal


@app.post("/api/student-portal/exercises/{exercise_id}/complete", response_model=schemas.ExerciseCompletionResponse)
def complete_exercise(
    exercise_id: str,
    db: Session = Depends(get_db),
    student: models.User = Depends(auth.get_current_user)
):
    # Verify exercise exists
    exercise = db.query(models.Exercise).filter(models.Exercise.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercício não encontrado.")
        
    # Verify exercise belongs to this student's workout sheet
    workout = db.query(models.Workout).filter(models.Workout.id == exercise.workout_id).first()
    if workout.student_id != student.id:
        raise HTTPException(status_code=403, detail="Você não pode marcar este exercício.")

    today = date.today()
    
    # Check if already completed today
    existing_completion = db.query(models.ExerciseCompletion).filter(
        models.ExerciseCompletion.student_id == student.id,
        models.ExerciseCompletion.exercise_id == exercise_id,
        models.ExerciseCompletion.completed_date == today
    ).first()
    
    if existing_completion:
        return existing_completion

    completion = models.ExerciseCompletion(
        student_id=student.id,
        exercise_id=exercise_id,
        completed_date=today
    )
    db.add(completion)
    db.commit()
    db.refresh(completion)
    return completion


@app.delete("/api/student-portal/exercises/{exercise_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
def undo_complete_exercise(
    exercise_id: str,
    db: Session = Depends(get_db),
    student: models.User = Depends(auth.get_current_user)
):
    today = date.today()
    completion = db.query(models.ExerciseCompletion).filter(
        models.ExerciseCompletion.student_id == student.id,
        models.ExerciseCompletion.exercise_id == exercise_id,
        models.ExerciseCompletion.completed_date == today
    ).first()
    
    if not completion:
        raise HTTPException(status_code=404, detail="Log de conclusão não encontrado para hoje.")
        
    db.delete(completion)
    db.commit()
    return None


# -------------------------------------------------------------
# 6. CATÁLOGO GLOBAL DE EXERCÍCIOS (Apenas Admin)
# -------------------------------------------------------------

@app.get("/api/catalog", response_model=List[schemas.CatalogExerciseResponse])
def list_catalog_exercises(
    q: Optional[str] = None,
    muscle_group: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    query = db.query(models.ExerciseCatalog)
    if q:
        query = query.filter(models.ExerciseCatalog.name.ilike(f"%{q}%"))
    if muscle_group:
        query = query.filter(models.ExerciseCatalog.muscle_group == muscle_group)
    return query.order_by(models.ExerciseCatalog.name).all()


@app.post("/api/catalog", response_model=schemas.CatalogExerciseResponse, status_code=status.HTTP_201_CREATED)
def create_catalog_exercise(
    catalog_in: schemas.CatalogExerciseCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    catalog_exercise = models.ExerciseCatalog(
        name=catalog_in.name,
        muscle_group=catalog_in.muscle_group,
        video_url=catalog_in.video_url,
        description=catalog_in.description
    )
    db.add(catalog_exercise)
    db.commit()
    db.refresh(catalog_exercise)
    return catalog_exercise


@app.put("/api/catalog/{catalog_id}", response_model=schemas.CatalogExerciseResponse)
def update_catalog_exercise(
    catalog_id: str,
    catalog_in: schemas.CatalogExerciseUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    catalog_exercise = db.query(models.ExerciseCatalog).filter(models.ExerciseCatalog.id == catalog_id).first()
    if not catalog_exercise:
        raise HTTPException(status_code=404, detail="Exercício do catálogo não encontrado.")
    
    update_data = catalog_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(catalog_exercise, key, value)
    
    db.commit()
    db.refresh(catalog_exercise)
    return catalog_exercise


@app.delete("/api/catalog/{catalog_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_exercise(
    catalog_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    catalog_exercise = db.query(models.ExerciseCatalog).filter(models.ExerciseCatalog.id == catalog_id).first()
    if not catalog_exercise:
        raise HTTPException(status_code=404, detail="Exercício do catálogo não encontrado.")
    
    db.delete(catalog_exercise)
    db.commit()
    return None


# -------------------------------------------------------------
# 7. ATIVIDADE DOS ALUNOS (Datas e Exercícios - Apenas Admin)
# -------------------------------------------------------------

@app.get("/api/students/{student_id}/activity")
def get_student_activity(
    student_id: str,
    days: int = Query(default=30, ge=1, le=365, description="Número de dias para consultar"),
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    """
    Returns the student's exercise completion history for the last N days.
    Includes active dates and exercises executed.
    """
    from datetime import timedelta
    
    # Verify student exists
    student = db.query(models.User).filter(models.User.id == student_id, models.User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Estudante não encontrado.")
    
    # Calculate date range
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    
    # Get all completions for this student within the date range
    completions = (
        db.query(models.ExerciseCompletion)
        .filter(
            models.ExerciseCompletion.student_id == student_id,
            models.ExerciseCompletion.completed_date >= start_date,
            models.ExerciseCompletion.completed_date <= end_date
        )
        .order_by(models.ExerciseCompletion.completed_date.desc(), models.ExerciseCompletion.completed_at.desc())
        .all()
    )
    
    # Build response grouped by date
    activity_by_date = {}
    for comp in completions:
        date_str = comp.completed_date.isoformat()
        if date_str not in activity_by_date:
            activity_by_date[date_str] = {
                "date": date_str,
                "exercises": []
            }
        
        # Get exercise and workout info
        exercise = db.query(models.Exercise).filter(models.Exercise.id == comp.exercise_id).first()
        workout = None
        if exercise:
            workout = db.query(models.Workout).filter(models.Workout.id == exercise.workout_id).first()
        
        activity_by_date[date_str]["exercises"].append({
            "exercise_id": comp.exercise_id,
            "exercise_name": exercise.name if exercise else "Exercício removido",
            "workout_title": workout.title if workout else "Ficha removida",
            "completed_at": comp.completed_at.isoformat() if comp.completed_at else None
        })
    
    # Sort dates descending
    sorted_activity = sorted(activity_by_date.values(), key=lambda x: x["date"], reverse=True)
    
    # Calculate summary stats
    total_active_days = len(activity_by_date)
    total_exercises_done = len(completions)
    
    # Active dates list (for calendar highlights)
    active_dates = list(activity_by_date.keys())
    
    return {
        "student_id": student_id,
        "student_name": student.name,
        "period_days": days,
        "total_active_days": total_active_days,
        "total_exercises_done": total_exercises_done,
        "active_dates": active_dates,
        "activity": sorted_activity
    }


# -------------------------------------------------------------
# 8. SISTEMA DE NOTIFICAÇÕES E ALERTAS DE PRAZO
# -------------------------------------------------------------

@app.get("/api/notifications", response_model=schemas.NotificationSummary)
def get_user_notifications(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Retorna notificações do usuário e executa verificação de vencimento para alunos."""
    if current_user.role == "student":
        check_and_create_workout_notifications(db, current_user.id)

    notifications = (
        db.query(models.Notification)
        .filter(models.Notification.user_id == current_user.id)
        .order_by(models.Notification.created_at.desc())
        .limit(50)
        .all()
    )
    total_unread = sum(1 for n in notifications if not n.is_read)
    
    return schemas.NotificationSummary(
        total_unread=total_unread,
        notifications=notifications
    )


@app.put("/api/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Marca uma notificação específica como lida."""
    notif = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.user_id == current_user.id
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificação não encontrada.")
        
    notif.is_read = True
    db.commit()
    return {"message": "Notificação marcada como lida."}


@app.put("/api/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Marca todas as notificações do usuário como lidas."""
    db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"message": "Todas as notificações foram marcadas como lidas."}


@app.get("/api/admin/expiring-workouts")
def get_expiring_workouts_admin(
    days: int = Query(default=30, ge=1, le=180, description="Dias para considerar próximo do vencimento"),
    item_type: str = Query(default="all", description="Filtro de tipo: 'all', 'workouts', ou 'goals'"),
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.get_admin_user)
):
    """
    Retorna todos os treinos e/ou datas metas de alunos que estão vencidos ou que vencem nos próximos N dias,
    com dados do aluno e link pronto para WhatsApp.
    """
    import urllib.parse

    today = date.today()
    limit_date = today + timedelta(days=days)

    result = []

    # 1. Prazos das Fichas de Treino
    if item_type in ("all", "workouts"):
        workouts = (
            db.query(models.Workout)
            .filter(models.Workout.end_date != None, models.Workout.end_date <= limit_date)
            .all()
        )

        for w in workouts:
            student = w.student
            if not student:
                continue
            status_str, days_left = compute_workout_status(w)
            end_date_fmt = w.end_date.strftime("%d/%m/%Y") if w.end_date else ""
            
            if status_str == "expired":
                days_ago = abs(days_left) if days_left is not None else 0
                wa_text = f"Olá, {student.name}! Tudo bem? Notei que o prazo da sua ficha \"{w.title}\" encerrou em {end_date_fmt} (há {days_ago} dias). Vamos agendar sua reavaliação para montarmos um novo treino?"
            elif status_str == "expiring_today":
                wa_text = f"Olá, {student.name}! A validade da sua ficha \"{w.title}\" termina hoje ({end_date_fmt}). Vamos combinar os próximos passos da sua periodização?"
            else:
                wa_text = f"Olá, {student.name}! Sua ficha de treino \"{w.title}\" vence em breve (dia {end_date_fmt}, restam {days_left} dias). Passando para nos organizarmos para o próximo ciclo de treinos!"

            clean_phone = "".join(filter(str.isdigit, student.phone or ""))
            if clean_phone and not clean_phone.startswith("55") and len(clean_phone) in (10, 11):
                clean_phone = f"55{clean_phone}"
            wa_link = f"https://wa.me/{clean_phone}?text={urllib.parse.quote(wa_text)}" if clean_phone else None

            result.append({
                "type": "workout",
                "workout_id": w.id,
                "workout_title": w.title,
                "student_id": student.id,
                "student_name": student.name,
                "student_phone": student.phone,
                "start_date": w.start_date.isoformat() if w.start_date else None,
                "end_date": w.end_date.isoformat() if w.end_date else None,
                "status": status_str,
                "days_remaining": days_left,
                "whatsapp_link": wa_link,
                "suggested_message": wa_text
            })

    # 2. Datas Metas de Acompanhamento dos Alunos
    if item_type in ("all", "goals"):
        students_with_goals = (
            db.query(models.User)
            .filter(
                models.User.role == "student",
                models.User.goal_date != None,
                models.User.goal_date <= limit_date
            )
            .all()
        )

        for s in students_with_goals:
            goal_diff = (s.goal_date - today).days
            goal_date_fmt = s.goal_date.strftime("%d/%m/%Y")

            if goal_diff < 0:
                status_str = "expired"
                days_ago = abs(goal_diff)
                wa_text = f"Olá, {s.name}! Tudo bem? A sua data meta / reavaliação agendada para {goal_date_fmt} encerrou há {days_ago} dias. Vamos agendar seu novo acompanhamento e avaliar sua evolução?"
            elif goal_diff == 0:
                status_str = "expiring_today"
                wa_text = f"Olá, {s.name}! Hoje ({goal_date_fmt}) é o dia da sua data meta / reavaliação física! Passando para combinarmos nosso encontro e avaliarmos seus resultados."
            else:
                status_str = "expiring_soon"
                wa_text = f"Olá, {s.name}! Falta pouco para sua data meta / reavaliação (dia {goal_date_fmt}, restam {goal_diff} dias). Vamos com foco total nessa reta final!"

            clean_phone = "".join(filter(str.isdigit, s.phone or ""))
            if clean_phone and not clean_phone.startswith("55") and len(clean_phone) in (10, 11):
                clean_phone = f"55{clean_phone}"
            wa_link = f"https://wa.me/{clean_phone}?text={urllib.parse.quote(wa_text)}" if clean_phone else None

            result.append({
                "type": "goal",
                "workout_id": None,
                "workout_title": "Data Meta de Acompanhamento / Reavaliação",
                "student_id": s.id,
                "student_name": s.name,
                "student_phone": s.phone,
                "start_date": None,
                "end_date": s.goal_date.isoformat(),
                "status": status_str,
                "days_remaining": goal_diff,
                "whatsapp_link": wa_link,
                "suggested_message": wa_text
            })

    result.sort(key=lambda x: (x["days_remaining"] if x["days_remaining"] is not None else 999))
    return result


from fastapi.staticfiles import StaticFiles
import os

# Mount Mobile PWA at /mobile (must be before the catch-all "/" route)
mobile_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../mobile"))
if os.path.exists(mobile_dir):
    app.mount("/mobile", StaticFiles(directory=mobile_dir, html=True), name="mobile")

# Mount Frontend Static Files at root "/"
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend"))
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
