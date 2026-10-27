import type { ModelDescription } from '../lib/catalog-api';
import { defineMessages, translateMessage, type WorkstationLocale } from './core';

/**
 * Presentation-only translations of src/wavedl_daemon/runs/model_metadata.json.
 * The complete English description and best-for text are exact source signatures.
 * Never replace daemon metadata, infer installed capability, or translate an ID.
 */
export const bundledModelMessages = defineMessages(
  {
    'cnn.description':
      "A vanilla convolutional neural network stacking Conv-BN-ReLU blocks with max-pooling for spatial reduction. Originating from LeCun's foundational work on gradient-based learning (1989), this architecture serves as the simplest deep learning baseline. It lacks modern enhancements like skip connections or attention, trading representational power for minimal complexity and fast iteration.",
    'cnn.bestFor': 'Quick baselines and prototyping across all data types',
    'resnet18.description':
      'ResNet-18 introduced identity shortcut connections that allow gradients to flow directly through the network, solving the degradation problem in deep networks. With 18 layers organized into 4 residual stages using BasicBlock (two 3*3 convolutions per block), it demonstrated that deeper networks could be trained reliably. This landmark 2015 architecture won the ImageNet challenge and remains one of the most widely used backbones in computer vision.',
    'resnet18.bestFor': 'General-purpose feature extraction for medium datasets',
    'resnet34.description':
      'ResNet-34 extends the ResNet family to 34 layers while still using BasicBlock residual units. The additional depth provides greater modeling capacity through more non-linear transformations, enabling the network to learn finer-grained feature hierarchies. It occupies a sweet spot between the lightweight ResNet-18 and the bottleneck-based ResNet-50, offering more capacity without the architectural complexity of 1*1 projection convolutions.',
    'resnet34.bestFor': 'Larger datasets needing more model capacity',
    'resnet50.description':
      'ResNet-50 introduces the Bottleneck block design — a 1*1→3*3→1*1 convolution sequence that reduces and then restores channel dimensions, enabling 50 layers with only slightly more parameters than ResNet-34. This architectural innovation makes deep networks computationally feasible while dramatically increasing representational power. ResNet-50 remains the de facto standard backbone for transfer learning and is one of the most benchmarked models in deep learning history.',
    'resnet50.bestFor': 'Complex feature hierarchies and large-scale tasks',
    'resnet18_pretrained.description':
      'This variant of ResNet-18 comes pre-initialized with weights learned on the ImageNet-1K dataset (1.28M images, 1000 classes). Transfer learning from these pretrained features dramatically reduces the amount of labeled data needed for new tasks, as the early layers already encode universal visual primitives like edges, textures, and shapes. Fine-tuning is typically done by replacing the classification head and training with a lower learning rate.',
    'resnet18_pretrained.bestFor': '2D image data with limited training samples',
    'resnet50_pretrained.description':
      'ResNet-50 pretrained on ImageNet-1K combines the powerful Bottleneck architecture with rich learned representations. The pretrained features capture complex visual hierarchies from millions of natural images, making it one of the most effective starting points for transfer learning in 2D vision tasks. Its deeper bottleneck structure extracts more discriminative features than ResNet-18, leading to higher accuracy when fine-tuned on downstream tasks.',
    'resnet50_pretrained.bestFor': 'High-accuracy 2D tasks with transfer learning',
    'densenet121.description':
      'DenseNet-121 connects each layer to every subsequent layer within a dense block, enabling maximum feature reuse and gradient flow. Unlike ResNets which add skip connections, DenseNet concatenates feature maps, allowing the network to learn compact representations with fewer parameters. Transition layers between dense blocks use 1*1 convolutions and average pooling for dimensionality reduction, making the architecture highly parameter-efficient.',
    'densenet121.bestFor': 'Parameter-efficient training with dense connectivity',
    'densenet169.description':
      'DenseNet-169 extends the DenseNet architecture to 169 layers with more dense blocks and layers per block, providing greater modeling capacity while maintaining the core dense connectivity pattern. The deeper architecture can capture more complex feature interactions through its extended chain of concatenated feature maps. It offers a meaningful step up from DenseNet-121 for tasks where the smaller variant lacks sufficient capacity.',
    'densenet169.bestFor': 'When DenseNet-121 capacity is insufficient',
    'densenet121_pretrained.description':
      "DenseNet-121 pretrained on ImageNet-1K leverages dense connectivity's feature reuse with rich learned visual representations. The densely connected pattern means that pretrained features from all preceding layers are available to every subsequent layer, creating an exceptionally rich feature space for transfer learning. With only 7M parameters, it offers one of the best accuracy-per-parameter ratios among pretrained models.",
    'densenet121_pretrained.bestFor': 'Efficient transfer learning for 2D image tasks',
    'mobilenet_v3_small.description':
      'MobileNetV3-Small was designed using a combination of hardware-aware neural architecture search (NAS) and the NetAdapt algorithm to optimize for mobile CPUs. It employs inverted residual blocks with lightweight depthwise separable convolutions, squeeze-and-excitation attention, and hard-swish activations. This architecture delivers remarkable accuracy for its minuscule parameter count, making it ideal for on-device inference.',
    'mobilenet_v3_small.bestFor': 'Edge deployment, very small 2D datasets, fast inference',
    'mobilenet_v3_large.description':
      'MobileNetV3-Large scales up the NAS-discovered architecture with wider layers and more inverted residual blocks, providing significantly better accuracy while maintaining mobile-friendly inference speeds. It incorporates h-swish activations in later layers and squeeze-and-excitation modules for channel recalibration. The architecture strikes an optimal balance between accuracy and latency for mobile deployment scenarios.',
    'mobilenet_v3_large.bestFor': 'Mobile deployment with better accuracy than Small variant',
    'efficientnet_b0.description':
      'EfficientNet-B0 is the baseline model discovered by neural architecture search that introduced compound scaling — simultaneously scaling network width, depth, and input resolution using fixed ratios. Built on mobile inverted bottleneck convolution (MBConv) blocks with squeeze-and-excitation, it achieved state-of-the-art accuracy with 8.4* fewer parameters than previous best models. This 2019 architecture fundamentally changed how the community thinks about model scaling.',
    'efficientnet_b0.bestFor': 'Small-to-medium 2D datasets with efficient compute',
    'efficientnet_b2.description':
      'EfficientNet-B2 applies the compound scaling coefficients to uniformly increase width, depth, and resolution from the B0 baseline. With approximately 1.7* more parameters than B0, it processes larger input resolutions (260*260 vs 224*224) and uses wider/deeper MBConv blocks. This balanced scaling provides meaningfully better accuracy while maintaining the efficiency principles of the EfficientNet family.',
    'efficientnet_b2.bestFor': 'Medium 2D datasets needing more expressiveness',
    'efficientnet_b4.description':
      'EfficientNet-B4 scales the architecture further with 380*380 input resolution, providing significantly higher accuracy at the cost of increased compute. It represents the point in the EfficientNet family where accuracy begins to rival much larger models like ResNet-152, while using far fewer parameters. The compound scaling ensures that the increased capacity is distributed evenly across width, depth, and resolution dimensions.',
    'efficientnet_b4.bestFor': 'Larger 2D datasets where accuracy is a priority',
    'efficientnet_b7.description':
      'EfficientNet-B7 pushes compound scaling to its practical limit with 600*600 input resolution, 66M parameters, and the deepest/widest MBConv configuration. It achieved 84.3% top-1 accuracy on ImageNet — state-of-the-art at its release — while being 8.4* smaller than the previous best GPipe model. However, the extreme resolution and depth make it one of the most resource-demanding models in the EfficientNet family.',
    'efficientnet_b7.bestFor': 'Large 2D datasets with ample GPU memory',
    'efficientnet_v2_s.description':
      'EfficientNetV2-S introduces Fused-MBConv blocks that replace the depthwise+pointwise pattern with a single fused convolution in early stages, dramatically improving training speed on modern accelerators. Combined with progressive learning — gradually increasing image resolution and regularization during training — it trains 5-11* faster than EfficientNetV1 while achieving better accuracy. This 2021 architecture represents a significant evolution in efficient model design.',
    'efficientnet_v2_s.bestFor': 'Fast, accurate training on medium 2D datasets',
    'efficientnet_v2_m.description':
      'EfficientNetV2-M scales up the V2 architecture with more Fused-MBConv and MBConv blocks, providing substantially higher accuracy while retaining the training speed advantages of progressive learning. It uses a mix of fused convolutions in early stages and depthwise separable convolutions in later stages, optimizing for both training throughput and model quality. This mid-range variant offers an excellent trade-off for serious production workloads.',
    'efficientnet_v2_m.bestFor': 'High-accuracy 2D tasks with good training efficiency',
    'efficientnet_v2_l.description':
      'EfficientNetV2-L is the largest variant in the V2 family, pushing the Fused-MBConv architecture to maximum scale with 117M parameters. Despite its size, it trains significantly faster than comparably accurate models from the V1 family due to progressive learning and optimized block design. It achieves near state-of-the-art ImageNet accuracy while maintaining the efficiency principles that define the EfficientNet lineage.',
    'efficientnet_v2_l.bestFor': 'Maximum accuracy on large 2D datasets',
    'regnet_y_400mf.description':
      "RegNet-Y 400MF belongs to the RegNet design space — a family of networks discovered by systematically exploring network width, depth, and group width patterns. The 'Y' variant adds squeeze-and-excitation modules for channel attention. Operating at a 400M FLOPs budget, it delivers strong accuracy for its compute class. The RegNet philosophy emphasizes simple, regular network structures that scale predictably, discovered through population-level analysis of network design spaces.",
    'regnet_y_400mf.bestFor': 'Lightweight 2D inference with consistent performance',
    'regnet_y_800mf.description':
      'RegNet-Y 800MF doubles the compute budget of the 400MF variant, providing wider layers and more groups for increased representational capacity. The design space methodology ensures that this scaling is optimal — each additional FLOP is allocated to maximize accuracy. With squeeze-and-excitation attention and well-tuned group convolutions, it represents one of the most efficient models at its compute level.',
    'regnet_y_800mf.bestFor': 'Balanced speed and accuracy for 2D tasks',
    'regnet_y_1_6gf.description':
      'RegNet-Y 1.6GF operates at a mid-range compute budget, providing substantial modeling capacity with predictable performance characteristics. The regular network structure — with linearly increasing widths and constant group widths — makes it particularly well-suited for hardware optimization and batch inference. At 10.3M parameters, it offers a compelling alternative to EfficientNet-B0/B2 with more predictable latency profiles.',
    'regnet_y_1_6gf.bestFor': 'Mid-range 2D tasks with predictable scaling',
    'regnet_y_3_2gf.description':
      "RegNet-Y 3.2GF scales into the higher-compute regime with 17.9M parameters, providing strong feature extraction capabilities for demanding 2D tasks. The systematic design space approach ensures that the architecture avoids common scaling pitfalls — each stage's width and depth are optimally balanced. Combined with SE attention, it delivers competitive accuracy against hand-designed architectures like ResNet-50 at a similar compute budget.",
    'regnet_y_3_2gf.bestFor': 'Higher-capacity 2D feature extraction',
    'regnet_y_8gf.description':
      'RegNet-Y 8GF is the largest RegNet-Y variant in this collection, operating at 8 billion FLOPs with 37.4M parameters. At this scale, it competes directly with large ConvNets and even some Transformer-based models in terms of accuracy. The regular structure and group convolutions enable efficient distributed training, while the 8GF compute budget allows for rich, deep feature hierarchies suitable for large-scale visual recognition tasks.',
    'regnet_y_8gf.bestFor': 'Large-scale 2D tasks needing strong representations',
    'convnext_tiny.description':
      'ConvNeXt systematically modernizes a standard ResNet by adopting Transformer design principles: patchify stem, inverted bottleneck blocks, depthwise separable 7*7 convolutions, fewer activation functions, LayerNorm instead of BatchNorm, and GELU activations. This 2022 architecture from Meta AI demonstrated that pure convolutional networks can match or exceed Swin Transformer accuracy when trained with modern recipes, challenging the assumed superiority of attention-based models.',
    'convnext_tiny.bestFor': 'Strong alternative to ViT on any-dimensional data',
    'convnext_small.description':
      'ConvNeXt Small widens the channel dimensions across all four stages compared to the Tiny variant, providing greater modeling capacity while maintaining the same modernized ConvNet design philosophy. The increased width allows for richer feature representations at each spatial resolution, making it better suited for datasets with higher visual complexity or fine-grained distinctions.',
    'convnext_small.bestFor': 'When ConvNeXt Tiny capacity is insufficient',
    'convnext_base.description':
      "ConvNeXt Base matches the parameter count and accuracy of ViT-Base while using only convolutional operations. At 87.6M parameters, it provides the largest ConvNeXt configuration in this collection, capable of learning highly complex feature hierarchies. Its hierarchical multi-stage design naturally produces multi-scale features, an advantage over ViT's single-scale representation for dense prediction tasks.",
    'convnext_base.bestFor': 'Large datasets needing Transformer-level performance',
    'convnext_tiny_pretrained.description':
      'ConvNeXt Tiny pretrained on ImageNet-1K combines the modernized ConvNet architecture with powerful learned representations. The pretrained features benefit from the modern training recipe including RandAugment, Mixup, CutMix, and strong regularization, producing significantly better transfer learning features than classic pretrained ResNets. This makes it one of the strongest 2D transfer learning backbones at its parameter count.',
    'convnext_tiny_pretrained.bestFor': 'High-quality 2D transfer learning',
    'convnext_v2_tiny.description':
      'ConvNeXt V2 enhances the original ConvNeXt with Global Response Normalization (GRN) — a novel layer that addresses feature collapse in self-supervised learning by normalizing and calibrating channel responses based on their global statistics. Co-designed with the Fully Convolutional Masked Autoencoder (FCMAE) pretraining framework, V2 models achieve significantly better representations especially when pretrained with self-supervised objectives, closing the gap between ConvNets and masked-image-modeling ViTs.',
    'convnext_v2_tiny.bestFor': 'Improved training stability across all dimensions',
    'convnext_v2_small.description':
      'ConvNeXt V2 Small scales up the V2 architecture with wider channels while retaining GRN layers throughout. The larger capacity benefits significantly from self-supervised pretraining via FCMAE, as the additional parameters can better leverage the richer representations learned from unlabeled data. This variant is particularly compelling when large unlabeled datasets are available for pretraining.',
    'convnext_v2_small.bestFor': 'Enhanced representations with self-supervised pretraining',
    'convnext_v2_base.description':
      'ConvNeXt V2 Base represents the pinnacle of pure convolutional architecture design, combining 87.7M parameters with GRN normalization and FCMAE compatibility. When pretrained with FCMAE on ImageNet, it achieves accuracy competitive with or exceeding masked-autoencoder ViT models, demonstrating that the ConvNet paradigm can match Transformer-based self-supervised learning when properly designed.',
    'convnext_v2_base.bestFor': 'Large-scale tasks with modern ConvNet architecture',
    'convnext_v2_tiny_pretrained.description':
      'ConvNeXt V2 Tiny pretrained combines the GRN-enhanced architecture with weights learned through modern training paradigms. The pretrained features capture robust visual representations that transfer exceptionally well to downstream 2D tasks, especially benefiting from the improved feature diversity enforced by Global Response Normalization during pretraining.',
    'convnext_v2_tiny_pretrained.bestFor': 'State-of-the-art 2D transfer learning',
    'unireplknet_tiny.description':
      'UniRepLKNet pushes convolutional kernel sizes to extremes (up to 31*31 or larger) using structural reparameterization, enabling convolutions to capture very long-range dependencies traditionally reserved for attention mechanisms. The architecture uses dilated reparam blocks that decompose large kernels into efficient parallel branches during training, then merge them into a single large kernel for inference. This provides Transformer-like global receptive fields with CNN computational characteristics.',
    'unireplknet_tiny.bestFor': 'Tasks requiring very large effective receptive fields',
    'unireplknet_small.description':
      'UniRepLKNet Small scales the channel widths and potentially kernel sizes beyond the Tiny variant, providing greater capacity for capturing complex spatial relationships. The structural reparameterization technique ensures that despite the massive effective kernel sizes, inference remains efficient by merging parallel branches. This variant is suited for tasks where spatial relationships span large portions of the input.',
    'unireplknet_small.bestFor': 'Complex spatial patterns across all dimensions',
    'unireplknet_base.description':
      'UniRepLKNet Base is the largest variant, maximizing both channel width and kernel size to achieve the broadest possible receptive field in a pure convolutional architecture. At 97.6M parameters, it demonstrates that extremely large convolutional kernels can compete with global attention on tasks requiring understanding of full-image context, such as semantic segmentation and object detection at scale.',
    'unireplknet_base.bestFor': 'Large-scale tasks needing global context capture',
    'vit_tiny.description':
      'ViT Tiny is a compact variant of the Vision Transformer that splits input images into fixed-size patches, linearly embeds them, and processes the sequence with standard Transformer encoder blocks featuring multi-head self-attention (MHSA). Introduced by Google Brain in 2020, ViT demonstrated that pure Transformer architectures — originally designed for NLP — can achieve excellent results on image classification when trained on sufficient data, challenging the dominance of CNNs.',
    'vit_tiny.bestFor': 'Small datasets where attention mechanisms help',
    'vit_small.description':
      'ViT Small uses 384-dimensional embeddings with 6 attention heads across 12 Transformer encoder layers, providing a solid balance of model capacity and computational requirements. Each layer applies multi-head self-attention followed by an MLP block with GELU activation and LayerNorm. This mid-range configuration captures complex token interactions while remaining trainable on single-GPU setups with moderate dataset sizes.',
    'vit_small.bestFor': 'Medium datasets with sufficient training data',
    'vit_base.description':
      'ViT Base (ViT-B/16) uses 768-dimensional embeddings with 12 attention heads across 12 layers, matching BERT-Base in architecture scale. With 85.3M parameters, it was the configuration that first demonstrated ViT could exceed CNN accuracy when pretrained on large datasets (JFT-300M). The global self-attention at every layer enables the model to learn dynamic, input-dependent feature aggregation patterns that are impossible for fixed-kernel convolutions.',
    'vit_base.bestFor': 'Large datasets where global self-attention is beneficial',
    'swin_t.description':
      'Swin Transformer revolutionized vision Transformers by introducing shifted-window (Swin) self-attention, which computes attention within local windows and shifts them between layers to enable cross-window connections. This achieves linear computational complexity with respect to image size (vs. quadratic for ViT) while maintaining a hierarchical feature pyramid similar to CNNs. The 2021 architecture won the ICCV Best Paper Honorable Mention and became a dominant backbone for detection and segmentation.',
    'swin_t.bestFor': '2D tasks needing hierarchical feature extraction',
    'swin_s.description':
      "Swin Small doubles the depth of the third stage compared to Swin Tiny, significantly increasing the model's capacity for learning complex visual patterns at the 1/16 resolution level. With 48.8M parameters, it provides a meaningful accuracy boost while retaining the efficient shifted-window attention mechanism. This variant is well-suited for tasks requiring richer mid-level feature representations.",
    'swin_s.bestFor': 'Medium-to-large 2D datasets with complex patterns',
    'swin_b.description':
      "Swin Base is the largest standard Swin variant with 86.7M parameters and 128-dimensional initial embeddings, providing maximum capacity within the Swin architecture family. Its hierarchical four-stage design with progressive downsampling generates rich multi-scale feature maps. Combined with shifted-window attention's linear complexity, it can process high-resolution images efficiently while capturing both local details and global context through cross-window interactions.",
    'swin_b.bestFor': 'Large 2D datasets with hierarchical features',
    'maxvit_tiny.description':
      'MaxViT introduces a novel multi-axis attention mechanism that combines blocked local attention (within spatial windows) and dilated global attention (across a grid of sparsely sampled tokens) in alternating layers. This dual-attention design captures both fine-grained local patterns and long-range global dependencies with linear complexity. Each MaxViT block also includes MBConv layers, creating a hybrid CNN-Transformer architecture that benefits from both convolutional inductive biases and global attention.',
    'maxvit_tiny.bestFor': '2D tasks needing both local and global attention',
    'maxvit_small.description':
      'MaxViT Small increases the channel dimensions and block counts compared to MaxViT Tiny, providing greater capacity for learning complex multi-scale visual features. The expanded multi-axis attention mechanism can capture more diverse spatial relationships, while the increased MBConv capacity enriches local feature extraction. This variant targets tasks demanding higher accuracy with complex spatial dependencies.',
    'maxvit_small.bestFor': 'Complex 2D tasks with multi-scale feature needs',
    'maxvit_base.description':
      "MaxViT Base is the largest variant at 119.1M parameters, maximizing the multi-axis attention mechanism's capacity. At this scale, the combination of blocked local attention, dilated global attention, and MBConv layers creates one of the most expressive vision architectures available. It has shown particularly strong results on image generation tasks (as a backbone for diffusion models) in addition to standard classification and detection benchmarks.",
    'maxvit_base.bestFor': 'Large 2D datasets with ample GPU resources',
    'fastvit_t8.description':
      'FastViT-T8 introduces RepMixer — a reparameterizable token mixing layer that uses depthwise convolutions during training and merges them into a single efficient operation at inference. Combined with a hybrid architecture that uses convolutional stages early and attention stages later, FastViT achieves a remarkable latency-accuracy trade-off. Developed by Apple for on-device deployment, it is one of the fastest hybrid vision models available.',
    'fastvit_t8.bestFor': 'Real-time 2D inference with minimal resources',
    'fastvit_t12.description':
      "FastViT-T12 increases model capacity over T8 with wider channels and more RepMixer blocks, providing better accuracy while retaining the ultra-fast inference characteristics of the FastViT family. The additional capacity enables it to capture more complex visual patterns, making it suitable for applications where T8's accuracy is slightly insufficient but real-time speed is still critical.",
    'fastvit_t12.bestFor': 'Speed-critical 2D tasks with better accuracy',
    'fastvit_s12.description':
      "FastViT-S12 moves into the 'Small' model tier with 8.8M parameters, using wider channels than the T-series while maintaining RepMixer's efficient token mixing. This variant balances inference speed and modeling capacity, making it practical for production deployments where both latency and accuracy requirements are moderate. The hybrid CNN-attention design captures local patterns via convolutions and global relationships via later attention stages.",
    'fastvit_s12.bestFor': 'Efficient 2D tasks needing moderate complexity',
    'fastvit_sa12.description':
      "FastViT-SA12 adds explicit self-attention (SA) stages on top of the RepMixer token mixing, creating a more expressive model that can capture complex global interactions. The 'SA' suffix indicates additional attention blocks in the later network stages, providing a meaningful accuracy boost over the S12 variant at a moderate latency cost. This design is optimal when slightly more compute budget is available for improved feature quality.",
    'fastvit_sa12.bestFor': '2D tasks benefiting from attention at higher resolution',
    'caformer_s18.description':
      'CAFormer (Convolution-Attention Former) is built on the MetaFormer hypothesis — that the general Transformer architecture is more important than the specific token mixer. It uses depthwise separable convolutions in early stages for local feature extraction and vanilla self-attention in later stages for global reasoning. This principled hybrid design, validated by the MetaFormer framework from Sea AI Lab, achieves excellent accuracy by leveraging the right inductive bias at each spatial resolution.',
    'caformer_s18.bestFor': '2D tasks needing strong token mixing strategies',
    'caformer_s36.description':
      'CAFormer-S36 doubles the depth of the S18 variant to 36 blocks, providing significantly more layers for both convolutional and attention-based token mixing. The increased depth enables the model to learn more complex feature transformations and more nuanced attention patterns in the later stages. This deeper variant excels on tasks requiring fine-grained distinctions or complex spatial reasoning.',
    'caformer_s36.bestFor': 'Complex 2D patterns requiring deeper processing',
    'caformer_m36.description':
      "CAFormer-M36 combines the 36-block depth with wider channel dimensions ('Medium' width), creating the most capable CAFormer variant in this collection. The expanded width provides richer feature representations at every stage, while the depth enables complex multi-step reasoning. This variant demonstrates the MetaFormer design's capacity to scale effectively along both width and depth dimensions.",
    'caformer_m36.bestFor': 'High-capacity 2D feature extraction',
    'poolformer_s12.description':
      'PoolFormer is the groundbreaking architecture that validated the MetaFormer hypothesis by replacing the attention mechanism with a simple average pooling operation as the token mixer — and still achieving competitive accuracy. This 2021 experiment proved that the general Transformer-style architecture (norm → mixer → norm → MLP) is more important than the specific mixing mechanism. Despite using no learned parameters in its token mixer, PoolFormer-S12 achieves accuracy comparable to DeiT-Small.',
    'poolformer_s12.bestFor': 'Efficient 2D tasks — proves architecture matters more',
    'efficientvit_m1.description':
      'EfficientViT-M1 replaces the quadratic softmax attention with a linear attention mechanism (ReLU-based kernel approximation), reducing both memory usage and computation to linear complexity in sequence length. Developed at MIT, this architecture is specifically designed for deployment on memory-constrained devices. The lightweight design uses a cascaded group attention pattern that reduces redundancy across attention heads, maximizing performance per parameter.',
    'efficientvit_m1.bestFor': 'Ultra-lightweight 2D inference on limited hardware',
    'efficientvit_b1.description':
      'EfficientViT-B1 scales up from the M-series with a balanced architecture that uses cascaded group attention to efficiently mix tokens across spatial dimensions. The B-series introduces wider channels and more stages while maintaining the linear-complexity attention mechanism. This variant provides a strong accuracy-speed trade-off suitable for edge GPUs and mobile devices that can handle slightly larger models than the M-series.',
    'efficientvit_b1.bestFor': 'Efficient 2D tasks with good accuracy-speed trade-off',
    'efficientvit_b2.description':
      'EfficientViT-B2 further expands the B-series with wider channels and deeper stages, pushing the accuracy boundary while retaining linear-complexity attention. At 21.8M parameters, it enters the mid-range model category and competes with standard ViT-Small and EfficientNet-B2 while offering superior inference speed due to its efficient attention mechanism. The architecture demonstrates that linear attention can scale to meaningful model sizes without sacrificing quality.',
    'efficientvit_b2.bestFor': 'Medium 2D datasets with memory-efficient attention',
    'efficientvit_l2.description':
      'EfficientViT-L2 is the largest variant in the MIT EfficientViT family, pushing linear attention to 60.5M parameters. At this scale, the architecture achieves accuracy competitive with standard quadratic-attention Transformers while maintaining significantly faster inference throughput. The L-series introduces additional architectural optimizations for large-scale deployment, making it suitable for server-side inference where throughput at moderate latency is the primary concern.',
    'efficientvit_l2.bestFor': 'Large-scale 2D tasks prioritizing inference speed',
    'mamba_1d.description':
      'Mamba introduces selective state spaces — a groundbreaking evolution of structured SSMs where the state transition matrices are input-dependent, allowing the model to selectively focus on or ignore information along the sequence. Combined with a hardware-aware parallel scan algorithm, Mamba achieves linear-time sequence processing with the expressiveness of attention-like mechanisms. This 2023 architecture has rapidly become the leading alternative to Transformers for long-sequence modeling.',
    'mamba_1d.bestFor': 'Long 1D sequences with linear-time processing',
    's4d_small.description':
      'S4D (Structured State Space for Sequences — Diagonal) simplifies the original S4 model by using diagonal state matrices instead of the full HiPPO-initialized DPLR matrices. This diagonal parameterization is mathematically equivalent for many practical cases while being significantly simpler to implement and faster to compute. At only 0.8M parameters, S4D Small is one of the smallest models capable of capturing very long-range dependencies in sequential data.',
    's4d_small.bestFor': 'Very long 1D signals with minimal parameters',
    's4d.description':
      'S4D is the standard-sized diagonal state space model that models sequential data through continuous-time linear recurrences discretized for digital processing. The diagonal state matrix enables efficient parallel computation via convolution in training mode and recurrent processing at inference. S4D captures dependencies across thousands of time steps, making it particularly effective for audio, scientific signals, and other long-range sequential tasks.',
    's4d.bestFor': 'Long-range 1D dependencies at sub-quadratic cost',
    's4d_large.description':
      "S4D Large expands the state dimensions and channel widths of the standard S4D model, providing greater capacity for capturing complex long-range temporal patterns. The larger state space enables more nuanced representations of sequential dynamics, while the increased channel width allows for richer feature extraction at each time step. This variant targets challenging 1D tasks where the standard S4D's capacity is insufficient.",
    's4d_large.bestFor': 'Complex 1D patterns requiring more model capacity',
    'vim_tiny.description':
      'Vision Mamba (Vim) adapts the selective state space model to 2D vision by flattening image patches into sequences and processing them with bidirectional Mamba blocks. The bidirectional scanning — processing patches left-to-right and right-to-left — enables the model to capture spatial relationships in both directions, partially compensating for the loss of 2D spatial structure. Vim achieves competitive accuracy with ViT while scaling linearly with image resolution instead of quadratically.',
    'vim_tiny.bestFor': '2D tasks with long-range spatial dependencies',
    'vim_small.description':
      'Vision Mamba Small scales up the Vim architecture with wider state dimensions and more Mamba blocks, providing greater capacity for learning complex 2D visual representations through SSM-based sequence processing. The increased model size enables richer bidirectional scanning patterns and more expressive state dynamics. At 51.1M parameters, it competes with ViT-Small and Swin-Tiny while offering better scaling to high-resolution inputs.',
    'vim_small.bestFor': 'Medium-to-large 2D datasets with sub-quadratic scaling',
    'vim_base.description':
      'Vision Mamba Base is the largest Vim variant at 201.4M parameters, pushing SSM-based vision processing to its current limits. The massive state space and wide channels enable the model to learn extremely rich bidirectional representations through selective state transitions. While resource-intensive, it demonstrates the potential of SSM architectures to scale to large vision models, offering a fundamentally different computational paradigm from Transformer-based vision.',
    'vim_base.bestFor': 'Large 2D datasets with very long-range dependencies',
    'tcn_small.description':
      'TCN Small is a compact temporal convolutional network that uses causal dilated convolutions — convolutions that exponentially increase their dilation factor at each layer to create an exponentially growing receptive field. Combined with residual connections and weight normalization, TCNs demonstrated in 2018 that convolutional architectures could match or exceed RNN/LSTM performance on sequence modeling benchmarks while being more parallelizable and having more stable gradients.',
    'tcn_small.bestFor': 'Short 1D time series with limited compute budget',
    'tcn.description':
      'The standard TCN uses multiple residual blocks of causal dilated 1D convolutions with exponentially increasing dilation factors (1, 2, 4, 8, ...), creating a large effective receptive field while maintaining a manageable parameter count. Each block includes weight normalization, ReLU activation, and dropout for regularization. This architecture provides a strong general-purpose baseline for 1D time series regression and classification tasks.',
    'tcn.bestFor': 'General-purpose 1D time series regression',
    'tcn_large.description':
      'TCN Large extends the standard TCN with wider channels and more residual blocks, significantly expanding both the receptive field and the representational capacity. The wider dilated convolutions capture more complex temporal patterns at each dilation scale, while additional blocks extend the maximum receptive field. This variant is designed for challenging temporal tasks with complex, long-range dependencies.',
    'tcn_large.bestFor': 'Complex 1D temporal patterns at longer ranges',
    'wavenet_small.description':
      "WaveNet Small is a compact version of DeepMind's WaveNet architecture that uses gated dilated causal convolutions — splitting each layer's output into tanh (filter) and sigmoid (gate) branches that are element-wise multiplied. This gating mechanism, inspired by LSTM gates, allows the network to learn which temporal features to pass through. Originally designed for raw audio waveform generation, the architecture excels on any 1D signal processing task.",
    'wavenet_small.bestFor': 'Short waveform signals with limited resources',
    'wavenet.description':
      "WaveNet uses stacked gated dilated causal convolutions with skip connections that sum outputs from all layers, creating a rich multi-resolution temporal representation. The doubling dilation pattern (1, 2, 4, ..., 512) across multiple stacks creates an exponentially large receptive field capable of modeling thousands of time steps. Originally achieving state-of-the-art text-to-speech quality in 2016, WaveNet's architecture has proven effective for general 1D temporal regression and signal processing.",
    'wavenet.bestFor': 'Audio-like 1D signals with exponential receptive field',
    'wavenet_large.description':
      "WaveNet Large adds more dilation stacks and wider channels to the standard WaveNet, dramatically expanding both the effective receptive field and the model's capacity to capture complex temporal patterns. The deeper stacking of gated dilated convolutions enables the model to process very long waveforms with multiple overlapping receptive field patterns. This variant is suited for tasks requiring the widest possible temporal context in 1D data.",
    'wavenet_large.bestFor': 'Long 1D waveforms requiring wide temporal coverage',
    'resnet3d_18.description':
      '3D ResNet-18 extends the ResNet architecture by replacing all 2D convolutions with 3D convolutions, enabling it to process volumetric data (depth * height * width) natively. Each 3D convolutional kernel operates across all three spatial dimensions simultaneously, capturing patterns that span the full volume. Originally developed for video understanding (treating time as the third dimension), it is equally applicable to medical imaging (CT/MRI), scientific simulations, and other volumetric datasets.',
    'resnet3d_18.bestFor': '3D volumes like CT scans or volumetric simulations',
    'mc3_18.description':
      'MC3-18 (Mixed Convolution 3D) uses 3D convolutions in early layers to capture low-level spatiotemporal features and transitions to 2D convolutions in later layers for efficient high-level feature extraction. This mixed approach, introduced alongside R(2+1)D by Facebook AI, significantly reduces computation compared to full 3D convolutions while retaining most of the representational benefit. The insight is that temporal and spatial features can be effectively factorized at deeper layers.',
    'mc3_18.bestFor': '3D data where full 3D convolutions are too expensive',
    'unet_regression.description':
      'U-Net features a symmetric encoder-decoder architecture connected by skip connections at each resolution level, enabling precise localization by combining deep semantic features with shallow spatial details. Originally designed for biomedical image segmentation (2015), this regression variant replaces the classification head with continuous output, making it suitable for dense prediction tasks like depth estimation, super-resolution, and field regression. The skip connections are the key innovation, allowing the decoder to recover fine spatial details lost during encoding.',
    'unet_regression.bestFor': 'Tasks needing multi-scale spatial context',
  },
  {
    'cnn.description':
      'Mạng nơ-ron tích chập cơ bản xếp chồng các khối Conv-BN-ReLU với phép gộp cực đại để giảm kích thước không gian. Bắt nguồn từ công trình nền tảng của LeCun về học dựa trên gradient (1989), kiến trúc này là mô hình cơ sở học sâu đơn giản nhất. Nó không có các cải tiến hiện đại như kết nối tắt hay cơ chế chú ý, đánh đổi khả năng biểu diễn để đạt độ phức tạp tối thiểu và tốc độ thử nghiệm nhanh.',
    'cnn.bestFor': 'Xây dựng mô hình cơ sở nhanh và thử nghiệm nguyên mẫu trên mọi loại dữ liệu',
    'resnet18.description':
      'ResNet-18 đưa vào các kết nối tắt đồng nhất, cho phép gradient truyền trực tiếp qua mạng và giải quyết vấn đề suy giảm ở mạng sâu. Với 18 lớp được tổ chức thành 4 giai đoạn dư dùng BasicBlock (hai phép tích chập 3*3 mỗi khối), nó cho thấy mạng sâu hơn có thể được huấn luyện ổn định. Kiến trúc tiêu biểu năm 2015 này chiến thắng cuộc thi ImageNet và vẫn là một trong những mạng nền được dùng rộng rãi nhất trong thị giác máy tính.',
    'resnet18.bestFor': 'Trích xuất đặc trưng đa dụng cho tập dữ liệu cỡ vừa',
    'resnet34.description':
      'ResNet-34 mở rộng họ ResNet lên 34 lớp nhưng vẫn dùng các đơn vị dư BasicBlock. Độ sâu tăng thêm mang lại khả năng mô hình hóa lớn hơn thông qua nhiều phép biến đổi phi tuyến, giúp mạng học các phân cấp đặc trưng chi tiết hơn. Nó nằm ở điểm cân bằng giữa ResNet-18 gọn nhẹ và ResNet-50 dùng khối nút thắt, tăng khả năng biểu diễn mà không cần độ phức tạp kiến trúc của tích chập chiếu 1*1.',
    'resnet34.bestFor': 'Tập dữ liệu lớn hơn cần mô hình có khả năng biểu diễn cao hơn',
    'resnet50.description':
      'ResNet-50 giới thiệu thiết kế khối Bottleneck — chuỗi tích chập 1*1→3*3→1*1 giảm rồi khôi phục số chiều kênh, cho phép xây dựng 50 lớp chỉ với số tham số nhỉnh hơn ResNet-34. Cải tiến kiến trúc này giúp việc tính toán mạng sâu trở nên khả thi đồng thời tăng mạnh khả năng biểu diễn. ResNet-50 vẫn là mạng nền tiêu chuẩn thực tế cho học chuyển giao và là một trong những mô hình được đánh giá nhiều nhất trong lịch sử học sâu.',
    'resnet50.bestFor': 'Phân cấp đặc trưng phức tạp và tác vụ quy mô lớn',
    'resnet18_pretrained.description':
      'Phiên bản ResNet-18 này được khởi tạo sẵn bằng trọng số học từ ImageNet-1K (1,28 triệu ảnh, 1000 lớp). Học chuyển giao từ những đặc trưng đã huấn luyện này giảm mạnh lượng dữ liệu có nhãn cần cho tác vụ mới, vì các lớp đầu đã mã hóa những thành phần thị giác phổ quát như cạnh, kết cấu và hình dạng. Tinh chỉnh thường được thực hiện bằng cách thay đầu phân loại và huấn luyện với tốc độ học thấp hơn.',
    'resnet18_pretrained.bestFor': 'Dữ liệu ảnh 2D có ít mẫu huấn luyện',
    'resnet50_pretrained.description':
      'ResNet-50 huấn luyện sẵn trên ImageNet-1K kết hợp kiến trúc Bottleneck mạnh với các biểu diễn phong phú đã học. Đặc trưng huấn luyện sẵn nắm bắt các phân cấp thị giác phức tạp từ hàng triệu ảnh tự nhiên, khiến nó trở thành một trong những điểm khởi đầu hiệu quả nhất cho học chuyển giao trong tác vụ thị giác 2D. Cấu trúc nút thắt sâu hơn trích xuất các đặc trưng phân biệt tốt hơn ResNet-18, mang lại độ chính xác cao hơn khi tinh chỉnh trên tác vụ tiếp theo.',
    'resnet50_pretrained.bestFor': 'Tác vụ 2D cần độ chính xác cao với học chuyển giao',
    'densenet121.description':
      'DenseNet-121 nối mỗi lớp với mọi lớp phía sau trong một khối kết nối dày đặc, tối đa hóa việc tái sử dụng đặc trưng và luồng gradient. Khác với ResNet cộng các kết nối tắt, DenseNet nối ghép các bản đồ đặc trưng, giúp mạng học biểu diễn gọn với ít tham số hơn. Các lớp chuyển tiếp giữa những khối dày đặc dùng tích chập 1*1 và gộp trung bình để giảm số chiều, khiến kiến trúc có hiệu quả tham số cao.',
    'densenet121.bestFor': 'Huấn luyện tiết kiệm tham số với kết nối dày đặc',
    'densenet169.description':
      'DenseNet-169 mở rộng kiến trúc DenseNet lên 169 lớp với nhiều khối dày đặc hơn và nhiều lớp hơn trong mỗi khối, tăng khả năng mô hình hóa trong khi giữ kiểu kết nối dày đặc cốt lõi. Kiến trúc sâu hơn có thể nắm bắt tương tác đặc trưng phức tạp hơn qua chuỗi bản đồ đặc trưng được nối ghép dài hơn. Đây là bước nâng cấp đáng kể so với DenseNet-121 cho tác vụ mà phiên bản nhỏ hơn chưa đủ khả năng biểu diễn.',
    'densenet169.bestFor': 'Khi khả năng biểu diễn của DenseNet-121 chưa đủ',
    'densenet121_pretrained.description':
      'DenseNet-121 huấn luyện sẵn trên ImageNet-1K kết hợp việc tái sử dụng đặc trưng nhờ kết nối dày đặc với các biểu diễn thị giác phong phú đã học. Kiểu kết nối dày đặc giúp mọi lớp phía sau sử dụng được các đặc trưng huấn luyện sẵn từ tất cả lớp trước, tạo không gian đặc trưng đặc biệt phong phú cho học chuyển giao. Chỉ với 7 triệu tham số, nó có một trong những tỷ lệ độ chính xác trên số tham số tốt nhất trong các mô hình huấn luyện sẵn.',
    'densenet121_pretrained.bestFor': 'Học chuyển giao hiệu quả cho tác vụ ảnh 2D',
    'mobilenet_v3_small.description':
      'MobileNetV3-Small được thiết kế bằng cách kết hợp tìm kiếm kiến trúc nơ-ron có xét phần cứng (NAS) với thuật toán NetAdapt để tối ưu cho CPU di động. Nó dùng các khối dư đảo ngược với tích chập tách biệt theo chiều sâu gọn nhẹ, cơ chế chú ý squeeze-and-excitation và hàm kích hoạt hard-swish. Kiến trúc đạt độ chính xác đáng kể với số tham số rất nhỏ, phù hợp cho suy luận trực tiếp trên thiết bị.',
    'mobilenet_v3_small.bestFor':
      'Triển khai trên thiết bị biên, tập dữ liệu 2D rất nhỏ và suy luận nhanh',
    'mobilenet_v3_large.description':
      'MobileNetV3-Large mở rộng kiến trúc tìm được bằng NAS với lớp rộng hơn và nhiều khối dư đảo ngược hơn, tăng đáng kể độ chính xác trong khi giữ tốc độ suy luận phù hợp thiết bị di động. Nó dùng hàm kích hoạt h-swish ở các lớp sau và mô-đun squeeze-and-excitation để hiệu chỉnh lại các kênh. Kiến trúc đạt cân bằng tối ưu giữa độ chính xác và độ trễ trong các tình huống triển khai di động.',
    'mobilenet_v3_large.bestFor': 'Triển khai di động cần độ chính xác tốt hơn phiên bản Small',
    'efficientnet_b0.description':
      'EfficientNet-B0 là mô hình cơ sở tìm được bằng tìm kiếm kiến trúc nơ-ron, giới thiệu cách mở rộng kết hợp — đồng thời tăng độ rộng, độ sâu và độ phân giải đầu vào theo các tỷ lệ cố định. Xây dựng từ các khối tích chập nút thắt đảo ngược di động (MBConv) với squeeze-and-excitation, nó đạt độ chính xác hàng đầu với số tham số ít hơn 8,4 lần so với các mô hình tốt nhất trước đó. Kiến trúc năm 2019 này làm thay đổi căn bản cách cộng đồng nghĩ về mở rộng mô hình.',
    'efficientnet_b0.bestFor': 'Tập dữ liệu 2D nhỏ đến vừa với tính toán hiệu quả',
    'efficientnet_b2.description':
      'EfficientNet-B2 áp dụng các hệ số mở rộng kết hợp để tăng đồng đều độ rộng, độ sâu và độ phân giải từ mô hình cơ sở B0. Với số tham số khoảng 1,7 lần B0, nó xử lý đầu vào có độ phân giải lớn hơn (260*260 so với 224*224) và dùng các khối MBConv rộng, sâu hơn. Cách mở rộng cân bằng này cải thiện đáng kể độ chính xác trong khi duy trì nguyên tắc hiệu quả của họ EfficientNet.',
    'efficientnet_b2.bestFor': 'Tập dữ liệu 2D cỡ vừa cần khả năng biểu diễn cao hơn',
    'efficientnet_b4.description':
      'EfficientNet-B4 tiếp tục mở rộng kiến trúc với đầu vào 380*380, tăng đáng kể độ chính xác nhưng cũng tăng chi phí tính toán. Đây là điểm trong họ EfficientNet mà độ chính xác bắt đầu sánh với các mô hình lớn hơn nhiều như ResNet-152, trong khi dùng ít tham số hơn hẳn. Mở rộng kết hợp bảo đảm khả năng biểu diễn tăng thêm được phân bổ đều theo độ rộng, độ sâu và độ phân giải.',
    'efficientnet_b4.bestFor': 'Tập dữ liệu 2D lớn hơn ưu tiên độ chính xác',
    'efficientnet_b7.description':
      'EfficientNet-B7 đẩy mở rộng kết hợp đến giới hạn thực tiễn với đầu vào 600*600, 66 triệu tham số và cấu hình MBConv sâu, rộng nhất. Nó đạt độ chính xác top-1 84,3% trên ImageNet — hàng đầu tại thời điểm ra mắt — trong khi nhỏ hơn 8,4 lần so với GPipe, mô hình tốt nhất trước đó. Tuy nhiên, độ phân giải và độ sâu rất lớn khiến đây là một trong những mô hình đòi hỏi nhiều tài nguyên nhất của họ EfficientNet.',
    'efficientnet_b7.bestFor': 'Tập dữ liệu 2D lớn với bộ nhớ GPU dồi dào',
    'efficientnet_v2_s.description':
      'EfficientNetV2-S giới thiệu các khối Fused-MBConv thay kiểu tích chập theo chiều sâu cộng tích chập điểm bằng một phép tích chập hợp nhất ở các giai đoạn đầu, tăng mạnh tốc độ huấn luyện trên bộ tăng tốc hiện đại. Kết hợp với học tiến triển — tăng dần độ phân giải ảnh và điều chuẩn trong quá trình huấn luyện — nó huấn luyện nhanh hơn EfficientNetV1 5–11 lần đồng thời đạt độ chính xác tốt hơn. Kiến trúc năm 2021 này là bước phát triển đáng kể trong thiết kế mô hình hiệu quả.',
    'efficientnet_v2_s.bestFor': 'Huấn luyện nhanh và chính xác trên tập dữ liệu 2D cỡ vừa',
    'efficientnet_v2_m.description':
      'EfficientNetV2-M mở rộng kiến trúc V2 với nhiều khối Fused-MBConv và MBConv hơn, tăng đáng kể độ chính xác trong khi giữ lợi thế tốc độ huấn luyện của học tiến triển. Nó kết hợp tích chập hợp nhất ở giai đoạn đầu với tích chập tách biệt theo chiều sâu ở giai đoạn sau, tối ưu cả thông lượng huấn luyện lẫn chất lượng mô hình. Phiên bản tầm trung này mang lại sự cân bằng tốt cho khối lượng công việc sản xuất chuyên sâu.',
    'efficientnet_v2_m.bestFor': 'Tác vụ 2D cần độ chính xác cao và hiệu quả huấn luyện tốt',
    'efficientnet_v2_l.description':
      'EfficientNetV2-L là phiên bản lớn nhất trong họ V2, đẩy kiến trúc Fused-MBConv lên quy mô tối đa với 117 triệu tham số. Dù lớn, nó huấn luyện nhanh hơn đáng kể so với các mô hình V1 có độ chính xác tương đương nhờ học tiến triển và thiết kế khối tối ưu. Nó đạt độ chính xác ImageNet gần mức hàng đầu trong khi duy trì các nguyên tắc hiệu quả đặc trưng của dòng EfficientNet.',
    'efficientnet_v2_l.bestFor': 'Độ chính xác tối đa trên tập dữ liệu 2D lớn',
    'regnet_y_400mf.description':
      'RegNet-Y 400MF thuộc không gian thiết kế RegNet — họ mạng được tìm ra bằng cách khảo sát có hệ thống các kiểu độ rộng mạng, độ sâu và độ rộng nhóm. Phiên bản Y thêm mô-đun squeeze-and-excitation để chú ý theo kênh. Với ngân sách 400 triệu FLOP, nó đạt độ chính xác cao trong nhóm chi phí tính toán của mình. Triết lý RegNet nhấn mạnh cấu trúc mạng đơn giản, đều đặn và mở rộng dễ dự đoán, được tìm ra qua phân tích ở cấp quần thể các không gian thiết kế mạng.',
    'regnet_y_400mf.bestFor': 'Suy luận 2D gọn nhẹ với hiệu năng nhất quán',
    'regnet_y_800mf.description':
      'RegNet-Y 800MF tăng gấp đôi ngân sách tính toán của phiên bản 400MF, dùng các lớp rộng hơn và nhiều nhóm hơn để tăng khả năng biểu diễn. Phương pháp không gian thiết kế bảo đảm mở rộng tối ưu — mỗi FLOP tăng thêm được phân bổ nhằm tối đa hóa độ chính xác. Với chú ý squeeze-and-excitation và tích chập nhóm được điều chỉnh tốt, đây là một trong những mô hình hiệu quả nhất ở mức tính toán của nó.',
    'regnet_y_800mf.bestFor': 'Cân bằng tốc độ và độ chính xác cho tác vụ 2D',
    'regnet_y_1_6gf.description':
      'RegNet-Y 1.6GF hoạt động ở ngân sách tính toán tầm trung, cung cấp khả năng mô hình hóa đáng kể với đặc tính hiệu năng dễ dự đoán. Cấu trúc mạng đều đặn — độ rộng tăng tuyến tính và độ rộng nhóm không đổi — đặc biệt phù hợp để tối ưu phần cứng và suy luận theo lô. Với 10,3 triệu tham số, nó là lựa chọn thay thế đáng chú ý cho EfficientNet-B0/B2 với đặc tính độ trễ dễ dự đoán hơn.',
    'regnet_y_1_6gf.bestFor': 'Tác vụ 2D tầm trung với khả năng mở rộng dễ dự đoán',
    'regnet_y_3_2gf.description':
      'RegNet-Y 3.2GF mở rộng lên mức tính toán cao hơn với 17,9 triệu tham số, mang lại khả năng trích xuất đặc trưng mạnh cho tác vụ 2D khó. Cách tiếp cận không gian thiết kế có hệ thống giúp kiến trúc tránh các vấn đề mở rộng thường gặp — độ rộng và độ sâu của từng giai đoạn được cân bằng tối ưu. Kết hợp với chú ý SE, nó đạt độ chính xác cạnh tranh với kiến trúc thiết kế thủ công như ResNet-50 ở ngân sách tính toán tương tự.',
    'regnet_y_3_2gf.bestFor': 'Trích xuất đặc trưng 2D với khả năng biểu diễn cao hơn',
    'regnet_y_8gf.description':
      'RegNet-Y 8GF là phiên bản RegNet-Y lớn nhất trong bộ này, dùng 8 tỷ FLOP với 37,4 triệu tham số. Ở quy mô này, nó cạnh tranh trực tiếp về độ chính xác với ConvNet lớn và cả một số mô hình dựa trên Transformer. Cấu trúc đều đặn và tích chập nhóm cho phép huấn luyện phân tán hiệu quả, còn ngân sách 8GF hỗ trợ phân cấp đặc trưng sâu, phong phú phù hợp tác vụ nhận dạng thị giác quy mô lớn.',
    'regnet_y_8gf.bestFor': 'Tác vụ 2D quy mô lớn cần biểu diễn mạnh',
    'convnext_tiny.description':
      'ConvNeXt hiện đại hóa có hệ thống ResNet tiêu chuẩn bằng các nguyên tắc thiết kế Transformer: tầng đầu chia thành mảnh, khối nút thắt đảo ngược, tích chập tách biệt theo chiều sâu 7*7, ít hàm kích hoạt hơn, LayerNorm thay BatchNorm và kích hoạt GELU. Kiến trúc năm 2022 từ Meta AI này chứng minh mạng thuần tích chập có thể ngang bằng hoặc vượt độ chính xác của Swin Transformer khi huấn luyện theo các phương pháp hiện đại, thách thức giả định rằng mô hình dựa trên chú ý luôn vượt trội.',
    'convnext_tiny.bestFor': 'Lựa chọn thay thế ViT mạnh trên dữ liệu ở mọi số chiều',
    'convnext_small.description':
      'ConvNeXt Small tăng số chiều kênh ở cả bốn giai đoạn so với Tiny, nâng khả năng mô hình hóa trong khi giữ triết lý thiết kế ConvNet hiện đại hóa. Độ rộng tăng thêm cho phép biểu diễn đặc trưng phong phú hơn ở từng độ phân giải không gian, phù hợp hơn với tập dữ liệu có độ phức tạp thị giác cao hoặc cần phân biệt chi tiết.',
    'convnext_small.bestFor': 'Khi khả năng biểu diễn của ConvNeXt Tiny chưa đủ',
    'convnext_base.description':
      'ConvNeXt Base đạt số tham số và độ chính xác ngang ViT-Base nhưng chỉ dùng phép tích chập. Với 87,6 triệu tham số, đây là cấu hình ConvNeXt lớn nhất trong bộ này, có khả năng học các phân cấp đặc trưng rất phức tạp. Thiết kế phân cấp nhiều giai đoạn tạo đặc trưng đa tỷ lệ một cách tự nhiên, là lợi thế so với biểu diễn đơn tỷ lệ của ViT trong tác vụ dự đoán dày đặc.',
    'convnext_base.bestFor': 'Tập dữ liệu lớn cần hiệu năng ở mức Transformer',
    'convnext_tiny_pretrained.description':
      'ConvNeXt Tiny huấn luyện sẵn trên ImageNet-1K kết hợp kiến trúc ConvNet hiện đại hóa với các biểu diễn mạnh đã học. Các đặc trưng huấn luyện sẵn hưởng lợi từ phương pháp huấn luyện hiện đại gồm RandAugment, Mixup, CutMix và điều chuẩn mạnh, tạo đặc trưng học chuyển giao tốt hơn đáng kể so với ResNet cổ điển huấn luyện sẵn. Điều này khiến nó trở thành một trong những mạng nền học chuyển giao 2D mạnh nhất ở cùng số tham số.',
    'convnext_tiny_pretrained.bestFor': 'Học chuyển giao 2D chất lượng cao',
    'convnext_v2_tiny.description':
      'ConvNeXt V2 cải tiến ConvNeXt gốc bằng Global Response Normalization (GRN) — lớp mới giải quyết hiện tượng sụp đổ đặc trưng trong học tự giám sát bằng cách chuẩn hóa và hiệu chỉnh đáp ứng kênh dựa trên thống kê toàn cục. Được đồng thiết kế với khung tiền huấn luyện Fully Convolutional Masked Autoencoder (FCMAE), mô hình V2 đạt biểu diễn tốt hơn đáng kể, đặc biệt khi tiền huấn luyện với mục tiêu tự giám sát, thu hẹp khoảng cách giữa ConvNet và ViT mô hình hóa ảnh che khuất.',
    'convnext_v2_tiny.bestFor': 'Cải thiện độ ổn định huấn luyện ở mọi số chiều',
    'convnext_v2_small.description':
      'ConvNeXt V2 Small mở rộng kiến trúc V2 với kênh rộng hơn trong khi giữ các lớp GRN xuyên suốt. Khả năng biểu diễn lớn hơn hưởng lợi rõ rệt từ tiền huấn luyện tự giám sát qua FCMAE, vì các tham số bổ sung khai thác tốt hơn những biểu diễn phong phú học từ dữ liệu không nhãn. Phiên bản này đặc biệt đáng chú ý khi có tập dữ liệu không nhãn lớn để tiền huấn luyện.',
    'convnext_v2_small.bestFor': 'Biểu diễn được cải thiện nhờ tiền huấn luyện tự giám sát',
    'convnext_v2_base.description':
      'ConvNeXt V2 Base đại diện cho đỉnh cao thiết kế kiến trúc thuần tích chập, kết hợp 87,7 triệu tham số với chuẩn hóa GRN và khả năng tương thích FCMAE. Khi tiền huấn luyện bằng FCMAE trên ImageNet, nó đạt độ chính xác cạnh tranh hoặc vượt mô hình ViT dùng bộ tự mã hóa che khuất, cho thấy mô hình ConvNet có thể sánh với học tự giám sát dựa trên Transformer nếu được thiết kế phù hợp.',
    'convnext_v2_base.bestFor': 'Tác vụ quy mô lớn với kiến trúc ConvNet hiện đại',
    'convnext_v2_tiny_pretrained.description':
      'ConvNeXt V2 Tiny huấn luyện sẵn kết hợp kiến trúc tăng cường GRN với trọng số học bằng các mô hình huấn luyện hiện đại. Các đặc trưng huấn luyện sẵn nắm bắt biểu diễn thị giác vững chắc, chuyển giao rất tốt sang tác vụ 2D tiếp theo, đặc biệt nhờ sự đa dạng đặc trưng được cải thiện bởi Global Response Normalization trong tiền huấn luyện.',
    'convnext_v2_tiny_pretrained.bestFor': 'Học chuyển giao 2D ở mức hàng đầu',
    'unireplknet_tiny.description':
      'UniRepLKNet đẩy kích thước nhân tích chập lên rất lớn (đến 31*31 hoặc hơn) bằng tái tham số hóa cấu trúc, giúp tích chập nắm bắt phụ thuộc rất xa vốn thường dành cho cơ chế chú ý. Kiến trúc dùng các khối tái tham số hóa giãn cách để phân rã nhân lớn thành các nhánh song song hiệu quả khi huấn luyện, rồi hợp nhất thành một nhân lớn khi suy luận. Điều này mang lại trường tiếp nhận toàn cục như Transformer với đặc tính tính toán của CNN.',
    'unireplknet_tiny.bestFor': 'Tác vụ cần trường tiếp nhận hiệu dụng rất lớn',
    'unireplknet_small.description':
      'UniRepLKNet Small mở rộng độ rộng kênh và có thể cả kích thước nhân so với Tiny, tăng khả năng nắm bắt quan hệ không gian phức tạp. Kỹ thuật tái tham số hóa cấu trúc bảo đảm suy luận vẫn hiệu quả dù kích thước nhân hiệu dụng rất lớn, nhờ hợp nhất các nhánh song song. Phiên bản này phù hợp tác vụ mà quan hệ không gian trải trên phần lớn đầu vào.',
    'unireplknet_small.bestFor': 'Mẫu không gian phức tạp ở mọi số chiều',
    'unireplknet_base.description':
      'UniRepLKNet Base là phiên bản lớn nhất, tối đa hóa cả độ rộng kênh lẫn kích thước nhân để đạt trường tiếp nhận rộng nhất có thể trong kiến trúc thuần tích chập. Với 97,6 triệu tham số, nó cho thấy nhân tích chập cực lớn có thể cạnh tranh với chú ý toàn cục ở các tác vụ cần hiểu ngữ cảnh toàn ảnh, như phân đoạn ngữ nghĩa và phát hiện đối tượng quy mô lớn.',
    'unireplknet_base.bestFor': 'Tác vụ quy mô lớn cần nắm bắt ngữ cảnh toàn cục',
    'vit_tiny.description':
      'ViT Tiny là phiên bản gọn của Vision Transformer, chia ảnh đầu vào thành các mảnh kích thước cố định, nhúng tuyến tính rồi xử lý chuỗi bằng các khối mã hóa Transformer tiêu chuẩn với tự chú ý nhiều đầu (MHSA). Được Google Brain giới thiệu năm 2020, ViT chứng minh kiến trúc thuần Transformer — ban đầu thiết kế cho xử lý ngôn ngữ tự nhiên — có thể đạt kết quả rất tốt trong phân loại ảnh khi được huấn luyện với đủ dữ liệu, thách thức ưu thế của CNN.',
    'vit_tiny.bestFor': 'Tập dữ liệu nhỏ mà cơ chế chú ý hữu ích',
    'vit_small.description':
      'ViT Small dùng phép nhúng 384 chiều với 6 đầu chú ý qua 12 lớp mã hóa Transformer, tạo cân bằng tốt giữa khả năng biểu diễn và yêu cầu tính toán. Mỗi lớp áp dụng tự chú ý nhiều đầu, sau đó là khối MLP với kích hoạt GELU và LayerNorm. Cấu hình tầm trung này nắm bắt tương tác token phức tạp mà vẫn có thể huấn luyện trên một GPU với tập dữ liệu cỡ vừa.',
    'vit_small.bestFor': 'Tập dữ liệu cỡ vừa với đủ dữ liệu huấn luyện',
    'vit_base.description':
      'ViT Base (ViT-B/16) dùng phép nhúng 768 chiều với 12 đầu chú ý qua 12 lớp, ngang quy mô kiến trúc BERT-Base. Với 85,3 triệu tham số, đây là cấu hình đầu tiên chứng minh ViT có thể vượt độ chính xác của CNN khi tiền huấn luyện trên tập dữ liệu lớn (JFT-300M). Tự chú ý toàn cục ở mỗi lớp cho phép mô hình học các kiểu tổng hợp đặc trưng động phụ thuộc đầu vào, điều mà tích chập nhân cố định không làm được.',
    'vit_base.bestFor': 'Tập dữ liệu lớn mà tự chú ý toàn cục hữu ích',
    'swin_t.description':
      'Swin Transformer đổi mới Transformer thị giác bằng tự chú ý cửa sổ dịch chuyển (Swin), tính chú ý trong các cửa sổ cục bộ rồi dịch chúng giữa các lớp để kết nối xuyên cửa sổ. Cách này đạt độ phức tạp tính toán tuyến tính theo kích thước ảnh (so với bậc hai của ViT) trong khi giữ tháp đặc trưng phân cấp tương tự CNN. Kiến trúc năm 2021 nhận giải khuyến khích bài báo xuất sắc tại ICCV và trở thành mạng nền phổ biến cho phát hiện và phân đoạn.',
    'swin_t.bestFor': 'Tác vụ 2D cần trích xuất đặc trưng phân cấp',
    'swin_s.description':
      'Swin Small tăng gấp đôi độ sâu của giai đoạn thứ ba so với Swin Tiny, nâng đáng kể khả năng học mẫu thị giác phức tạp ở mức độ phân giải 1/16. Với 48,8 triệu tham số, nó cải thiện đáng kể độ chính xác trong khi giữ cơ chế chú ý cửa sổ dịch chuyển hiệu quả. Phiên bản này phù hợp tác vụ cần biểu diễn đặc trưng trung gian phong phú hơn.',
    'swin_s.bestFor': 'Tập dữ liệu 2D vừa đến lớn với mẫu phức tạp',
    'swin_b.description':
      'Swin Base là phiên bản Swin tiêu chuẩn lớn nhất với 86,7 triệu tham số và phép nhúng ban đầu 128 chiều, cung cấp khả năng biểu diễn tối đa trong họ kiến trúc Swin. Thiết kế phân cấp bốn giai đoạn với giảm lấy mẫu dần tạo bản đồ đặc trưng đa tỷ lệ phong phú. Kết hợp với độ phức tạp tuyến tính của chú ý cửa sổ dịch chuyển, nó xử lý ảnh độ phân giải cao hiệu quả và nắm bắt cả chi tiết cục bộ lẫn ngữ cảnh toàn cục qua tương tác xuyên cửa sổ.',
    'swin_b.bestFor': 'Tập dữ liệu 2D lớn với đặc trưng phân cấp',
    'maxvit_tiny.description':
      'MaxViT giới thiệu cơ chế chú ý đa trục mới, kết hợp chú ý cục bộ theo khối (trong cửa sổ không gian) và chú ý toàn cục giãn cách (trên lưới token lấy mẫu thưa) ở các lớp luân phiên. Thiết kế chú ý kép nắm bắt cả mẫu cục bộ chi tiết lẫn phụ thuộc toàn cục xa với độ phức tạp tuyến tính. Mỗi khối MaxViT còn có các lớp MBConv, tạo kiến trúc lai CNN-Transformer hưởng lợi từ cả thiên hướng quy nạp tích chập lẫn chú ý toàn cục.',
    'maxvit_tiny.bestFor': 'Tác vụ 2D cần cả chú ý cục bộ và toàn cục',
    'maxvit_small.description':
      'MaxViT Small tăng số chiều kênh và số khối so với MaxViT Tiny, nâng khả năng học đặc trưng thị giác đa tỷ lệ phức tạp. Cơ chế chú ý đa trục mở rộng có thể nắm bắt quan hệ không gian đa dạng hơn, còn khả năng biểu diễn MBConv tăng thêm làm phong phú việc trích xuất đặc trưng cục bộ. Phiên bản này hướng tới tác vụ cần độ chính xác cao hơn với phụ thuộc không gian phức tạp.',
    'maxvit_small.bestFor': 'Tác vụ 2D phức tạp cần đặc trưng đa tỷ lệ',
    'maxvit_base.description':
      'MaxViT Base là phiên bản lớn nhất với 119,1 triệu tham số, tối đa hóa khả năng biểu diễn của cơ chế chú ý đa trục. Ở quy mô này, sự kết hợp chú ý cục bộ theo khối, chú ý toàn cục giãn cách và các lớp MBConv tạo một trong những kiến trúc thị giác giàu khả năng biểu diễn nhất. Nó cho kết quả đặc biệt tốt trong tác vụ tạo ảnh (làm mạng nền cho mô hình khuếch tán), bên cạnh các bài đánh giá phân loại và phát hiện tiêu chuẩn.',
    'maxvit_base.bestFor': 'Tập dữ liệu 2D lớn với tài nguyên GPU dồi dào',
    'fastvit_t8.description':
      'FastViT-T8 giới thiệu RepMixer — lớp trộn token có thể tái tham số hóa, dùng tích chập theo chiều sâu khi huấn luyện rồi hợp nhất thành một phép toán hiệu quả khi suy luận. Kết hợp với kiến trúc lai dùng giai đoạn tích chập ở đầu và chú ý ở sau, FastViT đạt sự cân bằng đáng kể giữa độ trễ và độ chính xác. Được Apple phát triển để triển khai trên thiết bị, đây là một trong những mô hình thị giác lai nhanh nhất.',
    'fastvit_t8.bestFor': 'Suy luận 2D thời gian thực với tài nguyên tối thiểu',
    'fastvit_t12.description':
      'FastViT-T12 tăng khả năng biểu diễn so với T8 bằng kênh rộng hơn và nhiều khối RepMixer hơn, cải thiện độ chính xác trong khi giữ đặc tính suy luận rất nhanh của họ FastViT. Khả năng tăng thêm giúp nó nắm bắt mẫu thị giác phức tạp hơn, phù hợp ứng dụng mà độ chính xác T8 hơi thiếu nhưng tốc độ thời gian thực vẫn thiết yếu.',
    'fastvit_t12.bestFor': 'Tác vụ 2D ưu tiên tốc độ nhưng cần độ chính xác tốt hơn',
    'fastvit_s12.description':
      'FastViT-S12 chuyển sang nhóm mô hình Small với 8,8 triệu tham số, dùng kênh rộng hơn dòng T trong khi giữ cách trộn token hiệu quả của RepMixer. Phiên bản này cân bằng tốc độ suy luận với khả năng mô hình hóa, phù hợp triển khai sản xuất khi yêu cầu độ trễ và độ chính xác đều ở mức vừa phải. Thiết kế lai CNN-chú ý nắm bắt mẫu cục bộ qua tích chập và quan hệ toàn cục qua giai đoạn chú ý phía sau.',
    'fastvit_s12.bestFor': 'Tác vụ 2D hiệu quả cần độ phức tạp vừa phải',
    'fastvit_sa12.description':
      'FastViT-SA12 thêm các giai đoạn tự chú ý (SA) tường minh bên cạnh trộn token RepMixer, tạo mô hình có khả năng biểu diễn cao hơn để nắm bắt tương tác toàn cục phức tạp. Hậu tố SA chỉ các khối chú ý bổ sung ở giai đoạn sau của mạng, tăng đáng kể độ chính xác so với S12 với mức tăng độ trễ vừa phải. Thiết kế này tối ưu khi có thêm một chút ngân sách tính toán để cải thiện chất lượng đặc trưng.',
    'fastvit_sa12.bestFor': 'Tác vụ 2D hưởng lợi từ chú ý ở độ phân giải cao hơn',
    'caformer_s18.description':
      'CAFormer (Convolution-Attention Former) dựa trên giả thuyết MetaFormer — kiến trúc Transformer tổng quát quan trọng hơn bộ trộn token cụ thể. Nó dùng tích chập tách biệt theo chiều sâu ở giai đoạn đầu để trích xuất đặc trưng cục bộ và tự chú ý cơ bản ở giai đoạn sau để suy luận toàn cục. Thiết kế lai có cơ sở này, được kiểm chứng bằng khung MetaFormer của Sea AI Lab, đạt độ chính xác rất tốt nhờ tận dụng thiên hướng quy nạp phù hợp ở từng độ phân giải không gian.',
    'caformer_s18.bestFor': 'Tác vụ 2D cần chiến lược trộn token mạnh',
    'caformer_s36.description':
      'CAFormer-S36 tăng gấp đôi độ sâu của S18 lên 36 khối, thêm đáng kể số lớp cho cả trộn token dựa trên tích chập lẫn chú ý. Độ sâu tăng giúp mô hình học phép biến đổi đặc trưng phức tạp hơn và mẫu chú ý tinh tế hơn ở các giai đoạn sau. Phiên bản sâu hơn này nổi bật ở tác vụ cần phân biệt chi tiết hoặc suy luận không gian phức tạp.',
    'caformer_s36.bestFor': 'Mẫu 2D phức tạp cần xử lý sâu hơn',
    'caformer_m36.description':
      'CAFormer-M36 kết hợp độ sâu 36 khối với số chiều kênh rộng hơn (độ rộng Medium), tạo phiên bản CAFormer có khả năng cao nhất trong bộ này. Độ rộng tăng mang lại biểu diễn đặc trưng phong phú hơn ở mọi giai đoạn, còn độ sâu cho phép suy luận phức tạp nhiều bước. Phiên bản này cho thấy thiết kế MetaFormer có thể mở rộng hiệu quả cả độ rộng lẫn độ sâu.',
    'caformer_m36.bestFor': 'Trích xuất đặc trưng 2D với khả năng biểu diễn cao',
    'poolformer_s12.description':
      'PoolFormer là kiến trúc đột phá kiểm chứng giả thuyết MetaFormer bằng cách thay cơ chế chú ý bằng phép gộp trung bình đơn giản làm bộ trộn token mà vẫn đạt độ chính xác cạnh tranh. Thử nghiệm năm 2021 cho thấy kiến trúc tổng quát kiểu Transformer (chuẩn hóa → trộn → chuẩn hóa → MLP) quan trọng hơn cơ chế trộn cụ thể. Dù không có tham số học trong bộ trộn token, PoolFormer-S12 đạt độ chính xác tương đương DeiT-Small.',
    'poolformer_s12.bestFor': 'Tác vụ 2D hiệu quả — cho thấy kiến trúc quan trọng hơn',
    'efficientvit_m1.description':
      'EfficientViT-M1 thay chú ý softmax có độ phức tạp bậc hai bằng chú ý tuyến tính (xấp xỉ nhân dựa trên ReLU), giảm cả bộ nhớ lẫn tính toán xuống độ phức tạp tuyến tính theo độ dài chuỗi. Được phát triển tại MIT, kiến trúc này được thiết kế riêng cho thiết bị hạn chế bộ nhớ. Thiết kế gọn nhẹ dùng chú ý nhóm nối tầng để giảm dư thừa giữa các đầu chú ý, tối đa hóa hiệu năng trên mỗi tham số.',
    'efficientvit_m1.bestFor': 'Suy luận 2D cực gọn nhẹ trên phần cứng hạn chế',
    'efficientvit_b1.description':
      'EfficientViT-B1 mở rộng dòng M bằng kiến trúc cân bằng dùng chú ý nhóm nối tầng để trộn token hiệu quả theo các chiều không gian. Dòng B có kênh rộng hơn và nhiều giai đoạn hơn trong khi giữ cơ chế chú ý độ phức tạp tuyến tính. Phiên bản này cân bằng tốt độ chính xác với tốc độ, phù hợp GPU biên và thiết bị di động có thể xử lý mô hình hơi lớn hơn dòng M.',
    'efficientvit_b1.bestFor': 'Tác vụ 2D hiệu quả với cân bằng tốt giữa độ chính xác và tốc độ',
    'efficientvit_b2.description':
      'EfficientViT-B2 tiếp tục mở rộng dòng B với kênh rộng hơn và các giai đoạn sâu hơn, nâng giới hạn độ chính xác trong khi giữ chú ý độ phức tạp tuyến tính. Với 21,8 triệu tham số, nó thuộc nhóm mô hình tầm trung, cạnh tranh với ViT-Small tiêu chuẩn và EfficientNet-B2 nhưng có tốc độ suy luận tốt hơn nhờ cơ chế chú ý hiệu quả. Kiến trúc cho thấy chú ý tuyến tính có thể mở rộng tới quy mô mô hình đáng kể mà không hy sinh chất lượng.',
    'efficientvit_b2.bestFor': 'Tập dữ liệu 2D cỡ vừa với chú ý tiết kiệm bộ nhớ',
    'efficientvit_l2.description':
      'EfficientViT-L2 là phiên bản lớn nhất trong họ EfficientViT của MIT, mở rộng chú ý tuyến tính lên 60,5 triệu tham số. Ở quy mô này, kiến trúc đạt độ chính xác cạnh tranh với Transformer chú ý bậc hai tiêu chuẩn trong khi giữ thông lượng suy luận nhanh hơn đáng kể. Dòng L bổ sung tối ưu kiến trúc cho triển khai quy mô lớn, phù hợp suy luận phía máy chủ khi thông lượng ở độ trễ vừa phải là ưu tiên chính.',
    'efficientvit_l2.bestFor': 'Tác vụ 2D quy mô lớn ưu tiên tốc độ suy luận',
    'mamba_1d.description':
      'Mamba giới thiệu không gian trạng thái chọn lọc — bước phát triển đột phá của SSM có cấu trúc, trong đó ma trận chuyển trạng thái phụ thuộc đầu vào, giúp mô hình chọn lọc tập trung hoặc bỏ qua thông tin dọc chuỗi. Kết hợp với thuật toán quét song song có xét phần cứng, Mamba xử lý chuỗi trong thời gian tuyến tính với khả năng biểu diễn như cơ chế chú ý. Kiến trúc năm 2023 này nhanh chóng trở thành lựa chọn thay thế Transformer hàng đầu cho mô hình hóa chuỗi dài.',
    'mamba_1d.bestFor': 'Chuỗi 1D dài với xử lý thời gian tuyến tính',
    's4d_small.description':
      'S4D (Structured State Space for Sequences — Diagonal) đơn giản hóa mô hình S4 gốc bằng ma trận trạng thái đường chéo thay cho ma trận DPLR đầy đủ khởi tạo theo HiPPO. Tham số hóa đường chéo này tương đương về toán học trong nhiều trường hợp thực tế nhưng dễ triển khai và tính toán nhanh hơn đáng kể. Chỉ với 0,8 triệu tham số, S4D Small là một trong những mô hình nhỏ nhất có thể nắm bắt phụ thuộc rất xa trong dữ liệu tuần tự.',
    's4d_small.bestFor': 'Tín hiệu 1D rất dài với số tham số tối thiểu',
    's4d.description':
      'S4D là mô hình không gian trạng thái đường chéo cỡ tiêu chuẩn, mô hình hóa dữ liệu tuần tự bằng truy hồi tuyến tính thời gian liên tục được rời rạc hóa để xử lý số. Ma trận trạng thái đường chéo cho phép tính toán song song hiệu quả qua tích chập khi huấn luyện và xử lý hồi quy khi suy luận. S4D nắm bắt phụ thuộc qua hàng nghìn bước thời gian, đặc biệt hiệu quả cho âm thanh, tín hiệu khoa học và các tác vụ tuần tự có phụ thuộc xa khác.',
    's4d.bestFor': 'Phụ thuộc xa trong 1D với chi phí dưới bậc hai',
    's4d_large.description':
      'S4D Large mở rộng số chiều trạng thái và độ rộng kênh của S4D tiêu chuẩn, tăng khả năng nắm bắt mẫu thời gian xa phức tạp. Không gian trạng thái lớn hơn cho phép biểu diễn động lực học chuỗi tinh tế hơn, còn kênh rộng hơn giúp trích xuất đặc trưng phong phú ở mỗi bước thời gian. Phiên bản này hướng tới tác vụ 1D khó mà khả năng biểu diễn của S4D tiêu chuẩn chưa đủ.',
    's4d_large.bestFor': 'Mẫu 1D phức tạp cần khả năng biểu diễn cao hơn',
    'vim_tiny.description':
      'Vision Mamba (Vim) đưa mô hình không gian trạng thái chọn lọc vào thị giác 2D bằng cách trải các mảnh ảnh thành chuỗi rồi xử lý bằng khối Mamba hai chiều. Quét hai chiều — xử lý các mảnh từ trái sang phải và phải sang trái — giúp nắm bắt quan hệ không gian theo cả hai hướng, phần nào bù cho việc mất cấu trúc không gian 2D. Vim đạt độ chính xác cạnh tranh với ViT trong khi mở rộng tuyến tính theo độ phân giải ảnh thay vì bậc hai.',
    'vim_tiny.bestFor': 'Tác vụ 2D có phụ thuộc không gian xa',
    'vim_small.description':
      'Vision Mamba Small mở rộng kiến trúc Vim với số chiều trạng thái rộng hơn và nhiều khối Mamba hơn, tăng khả năng học biểu diễn thị giác 2D phức tạp qua xử lý chuỗi dựa trên SSM. Quy mô lớn hơn cho phép mẫu quét hai chiều phong phú hơn và động lực học trạng thái giàu khả năng biểu diễn hơn. Với 51,1 triệu tham số, nó cạnh tranh với ViT-Small và Swin-Tiny đồng thời mở rộng tốt hơn với đầu vào độ phân giải cao.',
    'vim_small.bestFor': 'Tập dữ liệu 2D vừa đến lớn với mở rộng dưới bậc hai',
    'vim_base.description':
      'Vision Mamba Base là phiên bản Vim lớn nhất với 201,4 triệu tham số, đẩy xử lý thị giác dựa trên SSM tới giới hạn hiện tại của nó. Không gian trạng thái rất lớn và kênh rộng giúp mô hình học biểu diễn hai chiều rất phong phú qua chuyển trạng thái chọn lọc. Dù cần nhiều tài nguyên, nó cho thấy tiềm năng mở rộng SSM thành mô hình thị giác lớn, cung cấp cách tính toán căn bản khác thị giác dựa trên Transformer.',
    'vim_base.bestFor': 'Tập dữ liệu 2D lớn với phụ thuộc rất xa',
    'tcn_small.description':
      'TCN Small là mạng tích chập thời gian gọn, dùng tích chập nhân quả giãn cách — các phép tích chập tăng hệ số giãn theo cấp số nhân ở mỗi lớp để tạo trường tiếp nhận lớn dần theo cấp số nhân. Kết hợp kết nối dư và chuẩn hóa trọng số, TCN chứng minh năm 2018 rằng kiến trúc tích chập có thể ngang bằng hoặc vượt RNN/LSTM trên các bài đánh giá mô hình hóa chuỗi, đồng thời dễ song song hóa hơn và có gradient ổn định hơn.',
    'tcn_small.bestFor': 'Chuỗi thời gian 1D ngắn với ngân sách tính toán hạn chế',
    'tcn.description':
      'TCN tiêu chuẩn dùng nhiều khối dư tích chập 1D nhân quả giãn cách với hệ số giãn tăng theo cấp số nhân (1, 2, 4, 8, ...), tạo trường tiếp nhận hiệu dụng lớn trong khi giữ số tham số ở mức hợp lý. Mỗi khối có chuẩn hóa trọng số, kích hoạt ReLU và dropout để điều chuẩn. Kiến trúc là mô hình cơ sở đa dụng mạnh cho hồi quy và phân loại chuỗi thời gian 1D.',
    'tcn.bestFor': 'Hồi quy chuỗi thời gian 1D đa dụng',
    'tcn_large.description':
      'TCN Large mở rộng TCN tiêu chuẩn bằng kênh rộng hơn và nhiều khối dư hơn, tăng đáng kể cả trường tiếp nhận lẫn khả năng biểu diễn. Các tích chập giãn cách rộng hơn nắm bắt mẫu thời gian phức tạp hơn ở từng tỷ lệ giãn, còn khối bổ sung mở rộng trường tiếp nhận tối đa. Phiên bản này được thiết kế cho tác vụ thời gian khó với phụ thuộc xa phức tạp.',
    'tcn_large.bestFor': 'Mẫu thời gian 1D phức tạp ở phạm vi xa hơn',
    'wavenet_small.description':
      'WaveNet Small là phiên bản gọn của kiến trúc WaveNet từ DeepMind, dùng tích chập nhân quả giãn cách có cổng — chia đầu ra mỗi lớp thành nhánh tanh (bộ lọc) và sigmoid (cổng), rồi nhân theo từng phần tử. Cơ chế cổng lấy cảm hứng từ cổng LSTM giúp mạng học đặc trưng thời gian nào cần truyền qua. Ban đầu được thiết kế để tạo dạng sóng âm thanh thô, kiến trúc này nổi bật trong các tác vụ xử lý tín hiệu 1D.',
    'wavenet_small.bestFor': 'Tín hiệu dạng sóng ngắn với tài nguyên hạn chế',
    'wavenet.description':
      'WaveNet dùng các tầng tích chập nhân quả giãn cách có cổng xếp chồng cùng kết nối tắt cộng đầu ra từ mọi lớp, tạo biểu diễn thời gian đa độ phân giải phong phú. Kiểu tăng gấp đôi độ giãn (1, 2, 4, ..., 512) qua nhiều chồng lớp tạo trường tiếp nhận lớn theo cấp số nhân, có thể mô hình hóa hàng nghìn bước thời gian. Ban đầu đạt chất lượng chuyển văn bản thành giọng nói hàng đầu năm 2016, kiến trúc WaveNet đã chứng minh hiệu quả cho hồi quy thời gian và xử lý tín hiệu 1D đa dụng.',
    'wavenet.bestFor': 'Tín hiệu 1D giống âm thanh với trường tiếp nhận tăng theo cấp số nhân',
    'wavenet_large.description':
      'WaveNet Large thêm nhiều chồng lớp giãn cách và kênh rộng hơn vào WaveNet tiêu chuẩn, mở rộng mạnh cả trường tiếp nhận hiệu dụng lẫn khả năng nắm bắt mẫu thời gian phức tạp. Việc xếp sâu hơn các tích chập giãn cách có cổng giúp mô hình xử lý dạng sóng rất dài với nhiều mẫu trường tiếp nhận chồng lấn. Phiên bản này phù hợp tác vụ cần ngữ cảnh thời gian rộng nhất có thể trong dữ liệu 1D.',
    'wavenet_large.bestFor': 'Dạng sóng 1D dài cần phạm vi thời gian rộng',
    'resnet3d_18.description':
      '3D ResNet-18 mở rộng ResNet bằng cách thay mọi tích chập 2D bằng tích chập 3D, cho phép xử lý trực tiếp dữ liệu thể tích (độ sâu * chiều cao * chiều rộng). Mỗi nhân tích chập 3D hoạt động đồng thời trên cả ba chiều không gian, nắm bắt mẫu trải khắp thể tích. Ban đầu được phát triển để hiểu video (xem thời gian là chiều thứ ba), nó cũng áp dụng cho ảnh y khoa (CT/MRI), mô phỏng khoa học và các tập dữ liệu thể tích khác.',
    'resnet3d_18.bestFor': 'Thể tích 3D như ảnh CT hoặc mô phỏng thể tích',
    'mc3_18.description':
      'MC3-18 (Mixed Convolution 3D) dùng tích chập 3D ở các lớp đầu để nắm bắt đặc trưng không gian-thời gian mức thấp, rồi chuyển sang tích chập 2D ở các lớp sau để trích xuất đặc trưng mức cao hiệu quả. Cách kết hợp này, được Facebook AI giới thiệu cùng R(2+1)D, giảm đáng kể tính toán so với tích chập 3D toàn phần trong khi giữ phần lớn lợi ích biểu diễn. Ý tưởng cốt lõi là có thể phân tách hiệu quả các đặc trưng thời gian và không gian ở các lớp sâu hơn.',
    'mc3_18.bestFor': 'Dữ liệu 3D khi tích chập 3D toàn phần quá tốn kém',
    'unet_regression.description':
      'U-Net có kiến trúc mã hóa-giải mã đối xứng, nối bằng kết nối tắt ở mỗi mức độ phân giải, giúp định vị chính xác bằng cách kết hợp đặc trưng ngữ nghĩa sâu với chi tiết không gian nông. Ban đầu được thiết kế cho phân đoạn ảnh y sinh (2015), phiên bản hồi quy này thay đầu phân loại bằng đầu ra liên tục, phù hợp dự đoán dày đặc như ước lượng độ sâu, siêu phân giải và hồi quy trường. Kết nối tắt là cải tiến chủ chốt, giúp bộ giải mã khôi phục chi tiết không gian nhỏ bị mất trong mã hóa.',
    'unet_regression.bestFor': 'Tác vụ cần ngữ cảnh không gian đa tỷ lệ',
  },
);

export interface ModelPresentation {
  readonly description: string;
  readonly bestFor: string;
  readonly untranslated: boolean;
}

function isBundledMessageKey(key: string): key is keyof typeof bundledModelMessages.en {
  return Object.hasOwn(bundledModelMessages.en, key);
}

/** Unknown IDs and changed daemon metadata remain authoritative, verbatim plaintext. */
export function modelPresentation(
  model: ModelDescription,
  locale: WorkstationLocale,
): ModelPresentation {
  const descriptionKey = `${model.id}.description`;
  const bestForKey = `${model.id}.bestFor`;
  const matches =
    isBundledMessageKey(descriptionKey) &&
    isBundledMessageKey(bestForKey) &&
    bundledModelMessages.en[descriptionKey] === model.description &&
    bundledModelMessages.en[bestForKey] === model.bestFor;
  if (
    locale === 'en' ||
    !matches ||
    !isBundledMessageKey(descriptionKey) ||
    !isBundledMessageKey(bestForKey)
  )
    return {
      description: model.description,
      bestFor: model.bestFor,
      untranslated: locale === 'vi' && !matches,
    };
  return {
    description: translateMessage(bundledModelMessages, locale, descriptionKey),
    bestFor: translateMessage(bundledModelMessages, locale, bestForKey),
    untranslated: false,
  };
}
