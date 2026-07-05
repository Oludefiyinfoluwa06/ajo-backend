import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { VerifyBvnDto } from './dto/verify-bvn.dto';
import { prisma } from '../../common/lib/prisma';
import { UpdateProfileDto } from './dto/user-profile.dto';

@Injectable()
export class UsersService {
  private encryptBvn(bvn: string): string {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY as string, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(bvn, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        displayName: true,
        profilePhotoUrl: true,
        phoneNumber: true,
        role: true,
        kycStatus: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return { data: user, message: 'Profile retrieved successfully' };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName && { displayName: dto.displayName }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        displayName: true,
        phoneNumber: true,
        profilePhotoUrl: true,
        kycStatus: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'PROFILE_UPDATED',
        entityType: 'User',
        entityId: userId,
        metadata: { fields: Object.keys(dto) },
      },
    });

    return { data: updated, message: 'Profile updated successfully' };
  }

  async submitBvn(userId: string, dto: VerifyBvnDto) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === 'VERIFIED') {
      throw new BadRequestException('KYC is already verified');
    }

    // Encrypt BVN before storing
    const bvnEncrypted = this.encryptBvn(dto.bvn);

    // TODO: validate BVN against Monnify BVN lookup API
    // For now we store it and mark as verified (stub)
    // Real implementation: call MonnifyService.verifyBvn(dto.bvn)
    // then compare returned name against user.fullName

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        bvnEncrypted,
        kycStatus: 'VERIFIED',
      },
      select: {
        id: true,
        kycStatus: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'KYC_SUBMITTED',
        entityType: 'User',
        entityId: userId,
      },
    });

    return { data: updated, message: 'BVN verified successfully' };
  }

  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        displayName: true,
        profilePhotoUrl: true,
        phoneNumber: true,
        role: true,
        kycStatus: true,
        isSuspended: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
