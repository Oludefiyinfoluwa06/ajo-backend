import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { prisma } from '../../common/lib/prisma';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        emailVerificationTokens: {
          create: {
            token: verificationToken,
            expiresAt,
          },
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
      },
    });

    // TODO: dispatch email job once notifications module is ready
    // For now log the token so you can test the verify endpoint
    console.log(`Verification token for ${user.email}: ${verificationToken}`);

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
      data: user,
    };
  }

  async verifyEmail(token: string) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record) throw new BadRequestException('Invalid verification token');
    if (record.usedAt)
      throw new BadRequestException('Token has already been used');
    if (record.expiresAt < new Date())
      throw new BadRequestException('Token has expired');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { isActive: true },
      }),
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Email verified successfully. You can now log in.' };
  }

  async login(dto: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    if (user.isSuspended) {
      throw new UnauthorizedException('Your account has been suspended');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    const tokens = this.generateTokens(user.id, user.email);

    return {
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          kycStatus: user.kycStatus,
        },
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive || user.isSuspended) {
        throw new UnauthorizedException();
      }

      const tokens = this.generateTokens(user.id, user.email);

      return {
        message: 'Tokens refreshed',
        data: tokens,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success — don't reveal if email exists
    if (!user) {
      return {
        message:
          'If an account with that email exists, a reset link has been sent.',
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // TODO: dispatch email job once notifications module is ready
    console.log(`Password reset token for ${user.email}: ${token}`);

    return {
      message:
        'If an account with that email exists, a reset link has been sent.',
    };
  }

  async resetPassword(token: string, dto: ResetPasswordDto) {
    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!record) throw new BadRequestException('Invalid reset token');
    if (record.usedAt)
      throw new BadRequestException('Token has already been used');
    if (record.expiresAt < new Date())
      throw new BadRequestException('Token has expired');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return {
      message:
        'Password reset successful. You can now log in with your new password.',
    };
  }

  private generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET') as any,
      expiresIn: this.configService.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as `${number}${'m'}`,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>(
        'JWT_REFRESH_SECRET',
      ) as any,
      expiresIn: this.configService.getOrThrow<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as `${number}${'d'}`,
    });

    return { accessToken, refreshToken };
  }
}
