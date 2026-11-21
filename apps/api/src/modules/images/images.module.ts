import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BrandingController, ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [AccessModule],
  controllers: [ImagesController, BrandingController],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
