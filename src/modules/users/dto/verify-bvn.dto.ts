import { IsString, Length } from 'class-validator';

export class VerifyBvnDto {
  @IsString()
  @Length(11, 11, { message: 'BVN must be exactly 11 digits' })
  bvn!: string;
}
