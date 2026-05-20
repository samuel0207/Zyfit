from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date

# ----------------- TOKEN SCHEMAS -----------------
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None


# ----------------- USER SCHEMAS -----------------
class UserBase(BaseModel):
    name: str
    email: EmailStr
    role: str = "student"
    weight: Optional[float] = None
    height: Optional[float] = None
    goals: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    weight: Optional[float] = None
    height: Optional[float] = None
    goals: Optional[str] = None
    password: Optional[str] = None

class UserResponse(UserBase):
    id: str
    password: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        orm_mode = True


# ----------------- EXERCISE SCHEMAS -----------------
class ExerciseBase(BaseModel):
    name: str
    sets: int = Field(gt=0, description="Number of sets")
    repetitions: str
    rest_time: str = "60s"
    video_url: Optional[str] = None
    order_index: int = 0

class ExerciseCreate(ExerciseBase):
    workout_id: str

class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    sets: Optional[int] = None
    repetitions: Optional[str] = None
    rest_time: Optional[str] = None
    video_url: Optional[str] = None
    order_index: Optional[int] = None

class ExerciseResponse(ExerciseBase):
    id: str
    workout_id: str
    created_at: datetime

    class Config:
        from_attributes = True
        orm_mode = True


# ----------------- WORKOUT SCHEMAS -----------------
class WorkoutBase(BaseModel):
    title: str
    description: Optional[str] = None

class WorkoutCreate(WorkoutBase):
    student_id: str

class WorkoutUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None

class WorkoutResponse(WorkoutBase):
    id: str
    student_id: str
    created_at: datetime
    updated_at: datetime
    exercises: List[ExerciseResponse] = []

    class Config:
        from_attributes = True
        orm_mode = True


# ----------------- STUDENT PORTAL SCHEMAS -----------------
class ExerciseStudentResponse(ExerciseBase):
    id: str
    workout_id: str
    completed_today: bool

    class Config:
        from_attributes = True
        orm_mode = True

class WorkoutStudentResponse(WorkoutBase):
    id: str
    student_id: str
    created_at: datetime
    updated_at: datetime
    exercises: List[ExerciseStudentResponse] = []

    class Config:
        from_attributes = True
        orm_mode = True


# ----------------- EXERCISE COMPLETION SCHEMAS -----------------
class ExerciseCompletionResponse(BaseModel):
    id: str
    student_id: str
    exercise_id: str
    completed_date: date
    completed_at: datetime

    class Config:
        from_attributes = True
        orm_mode = True
