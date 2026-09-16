import uuid
from datetime import datetime, date
from sqlalchemy import Column, String, Integer, Float, ForeignKey, DateTime, Date, Text, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from app.database import Base

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False)
    phone = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    password = Column(String(100), nullable=True)  # Stores plain text password for easy admin lookup
    role = Column(String(20), nullable=False)  # 'admin' or 'student'
    
    # Student specific fields (nullable)
    weight = Column(Float, nullable=True)
    height = Column(Float, nullable=True)
    goals = Column(Text, nullable=True)
    goal_date = Column(Date, nullable=True)  # Target/meta date for student tracking
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    workouts = relationship("Workout", back_populates="student", cascade="all, delete-orphan")
    completions = relationship("ExerciseCompletion", back_populates="student", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")


class Workout(Base):
    __tablename__ = "workouts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    student_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    days_of_week = Column(String(150), nullable=True)  # Comma-separated days like "Segunda, Quarta"
    start_date = Column(Date, nullable=True)  # Início do período da ficha
    end_date = Column(Date, nullable=True)    # Término / vencimento da ficha
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    student = relationship("User", back_populates="workouts")
    exercises = relationship("Exercise", back_populates="workout", cascade="all, delete-orphan", order_by="Exercise.order_index")
    notifications = relationship("Notification", back_populates="workout", cascade="all, delete-orphan")


class Exercise(Base):
    __tablename__ = "exercises"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workout_id = Column(String(36), ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(500), nullable=False)
    sets = Column(Integer, nullable=False)
    repetitions = Column(String(50), nullable=False)
    rest_time = Column(String(30), nullable=False, default="60s")
    video_url = Column(String(512), nullable=True)
    order_index = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    workout = relationship("Workout", back_populates="exercises")
    completions = relationship("ExerciseCompletion", back_populates="exercise", cascade="all, delete-orphan")


class ExerciseCompletion(Base):
    __tablename__ = "exercise_completions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    student_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    exercise_id = Column(String(36), ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    completed_date = Column(Date, default=date.today, nullable=False)
    completed_at = Column(DateTime, default=datetime.utcnow)

    # Composite unique constraint to avoid duplicating completion of same exercise on the same day
    __table_args__ = (
        UniqueConstraint('student_id', 'exercise_id', 'completed_date', name='uq_student_exercise_date'),
    )

    # Relationships
    student = relationship("User", back_populates="completions")
    exercise = relationship("Exercise", back_populates="completions")


class ExerciseCatalog(Base):
    """Global exercise library/catalog — exercise templates reusable across all students."""
    __tablename__ = "exercise_catalog"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(500), nullable=False)
    muscle_group = Column(String(100), nullable=True)  # e.g. "Peito", "Costas", "Pernas"
    video_url = Column(String(512), nullable=True)
    description = Column(Text, nullable=True)  # Optional instructions/notes
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    """Notificações do sistema para alunos e professores."""
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workout_id = Column(String(36), ForeignKey("workouts.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(50), default="workout_deadline")  # 'workout_deadline', 'workout_expiring_soon', 'workout_expired', 'info'
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="notifications")
    workout = relationship("Workout", back_populates="notifications")

