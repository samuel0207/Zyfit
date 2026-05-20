import sys
import os
# Dynamically add backend and app directories to sys.path to ensure correct module resolution on Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import date, datetime
from typing import List, Optional

from app.config import settings
from app.database import engine, Base, get_db
from app import models, schemas, auth

# Auto-create tables on startup
Base.metadata.create_all(bind=engine)

# Auto-migrate: Add days_of_week column to workouts if it doesn't exist
from sqlalchemy import text
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE workouts ADD COLUMN days_of_week VARCHAR(150);"))
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute(text("ALTER TABLE users RENAME COLUMN email TO phone;"))
        conn.commit()
    except Exception:
        pass

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API REST de Gestão de Treinos Físicos para Professores e Alunos",
    version="1.0.0"
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
                phone="11999999999",
                password_hash=auth.get_password_hash("admin123"),
                password="admin123",
                role="admin"
            )
            db.add(admin_user)
            db.commit()
            print("\n" + "="*50)
            print("SEED DATABASE: Usuário Admin padrão criado com sucesso!")
            print("Celular: 11999999999")
            print("Senha: admin123")
            print("="*50 + "\n")
        elif "@" in admin.phone:
            # Upgrade legacy admin from email to cellphone
            admin.phone = "11999999999"
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
        weight=student_in.weight,
        height=student_in.height,
        goals=student_in.goals
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
        days_of_week=workout_in.days_of_week
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return workout


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
        
    return workout


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
    return workout


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
            
        workouts_portal.append(
            schemas.WorkoutStudentResponse(
                id=w.id,
                student_id=w.student_id,
                title=w.title,
                description=w.description,
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

from fastapi.staticfiles import StaticFiles
import os

# Mount Frontend Static Files at root "/"
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend"))
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
