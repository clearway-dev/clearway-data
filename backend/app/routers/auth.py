from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.deps import get_current_active_user, require_admin
from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.security import create_access_token, get_password_hash, verify_password
from app.database import get_db
from app.models import User
from app.schemas import Token, UserCreate, UserOut, UserUpdate

router = APIRouter()


@router.post("/login/access-token", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """OAuth2-compatible login. Returns a Bearer JWT."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user.")

    access_token = create_access_token(
        data={"sub": user.email, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(access_token=access_token, token_type="bearer")


@router.get("/users/me", response_model=UserOut)
def read_users_me(current_user: User = Depends(get_current_active_user)):
    """Return the profile of the currently authenticated user."""
    return current_user


# ---------------------------------------------------------------------------
# Admin-only user management
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[UserOut], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    """List all users (admin only)."""
    return db.query(User).order_by(User.id).all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_admin)])
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    """Create a new user (admin only)."""
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")
    user = User(
        email=body.email,
        hashed_password=get_password_hash(body.password),
        full_name=body.full_name,
        role=body.role,
        is_active=body.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    """Update a user (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if body.email is not None:
        existing = db.query(User).filter(User.email == body.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use.")
        user.email = body.email
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.hashed_password = get_password_hash(body.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a user (admin only). Cannot delete yourself."""
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    db.delete(user)
    db.commit()