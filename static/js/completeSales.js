// completeSales.js - FRONTEND SALES PROCESSOR
import { db } from "./firebase-config.js";
import { doc, updateDoc, arrayUnion, increment, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ====================================================
// SALE PROCESSOR CLASS
// ====================================================
class SaleProcessor {
    constructor(shopId, userId, sellerInfo) {
        this.shopId = shopId;
        this.userId = userId;
        this.seller = sellerInfo;
        this.batch = writeBatch(db);
    }
    
    // Calculate base quantity (handles selling unit conversion)
    calculateBaseQuantity(item) {
        if (item.type === 'selling_unit') {
            // Convert selling units to base units
            return item.quantity * (item.conversion_factor || 1);
        }
        // Main item - no conversion needed
        return item.quantity;
    }
    
    // Update item stock and batch
    async processItem(item) {
        const baseQty = this.calculateBaseQuantity(item);
        const itemRef = doc(db, 'Shops', this.shopId, 'items', item.item_id);
        
        console.log(`📦 Processing: ${item.name}`);
        console.log(`   Type: ${item.type}, Qty: ${item.quantity}`);
        console.log(`   Base Qty: ${baseQty}, Batch: ${item.batch_id}`);
        
        // 1. Update main stock
        this.batch.update(itemRef, {
            'stock': increment(-baseQty),
            'lastStockUpdate': new Date().toISOString(),
            'lastTransactionId': `sale_${Date.now()}`,
            'updatedAt': serverTimestamp()
        });
        
        // 2. Create transaction record
        const transaction = {
            id: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            type: 'sale',
            batchId: item.batch_id,
            quantity: baseQty,
            sellPrice: item.price || item.sellPrice || 0,
            unitPrice: item.price || item.sellPrice || 0,
            totalPrice: baseQty * (item.price || item.sellPrice || 0),
            unit: 'unit',
            performedBy: this.seller,
            timestamp: Date.now(),
            item_type: item.type,
            selling_units_quantity: item.type === 'selling_unit' ? item.quantity : null,
            conversion_factor: item.conversion_factor || null,
            item_name: item.name
        };
        
        this.batch.update(itemRef, {
            'stockTransactions': arrayUnion(transaction)
        });
        
        return { baseQty, transaction };
    }
    
    // Create receipt
    createReceipt(items, paymentDetails) {
        const receiptId = `receipt_${Date.now()}_${this.userId.substr(0, 8)}`;
        const receiptRef = doc(db, 'Shops', this.shopId, 'receipts', receiptId);
        
        // Calculate totals
        let totalBaseUnits = 0;
        let totalAmount = 0;
        
        const processedItems = items.map(item => {
            const baseQty = this.calculateBaseQuantity(item);
            const itemTotal = baseQty * (item.price || item.sellPrice || 0);
            
            totalBaseUnits += baseQty;
            totalAmount += itemTotal;
            
            return {
                ...item,
                base_quantity_deducted: baseQty,
                item_total: itemTotal
            };
        });
        
        const receiptData = {
            id: receiptId,
            shopId: this.shopId,
            timestamp: new Date().toISOString(),
            seller: this.seller,
            items: processedItems,
            summary: {
                total_items: items.length,
                total_base_units: totalBaseUnits,
                total_amount: totalAmount,
                contains_selling_units: items.some(i => i.type === 'selling_unit')
            },
            payment: paymentDetails,
            status: 'completed',
            created_at: serverTimestamp()
        };
        
        this.batch.set(receiptRef, receiptData);
        
        return { receiptId, totalAmount, totalBaseUnits };
    }
    
    // Process complete sale
    async processSale(cartItems, paymentDetails) {
        console.log('🔄 Starting frontend sale processing...');
        console.log(`🏪 Shop: ${this.shopId}`);
        console.log(`👤 Seller: ${this.seller.name}`);
        console.log(`🛍️ Items: ${cartItems.length}`);
        
        try {
            // Process each item
            for (const item of cartItems) {
                await this.processItem(item);
            }
            
            // Create receipt
            const { receiptId, totalAmount } = this.createReceipt(cartItems, paymentDetails);
            
            // Execute ALL operations atomically
            await this.batch.commit();
            
            console.log('✅ Sale completed successfully!');
            console.log(`   Receipt: ${receiptId}`);
            console.log(`   Total: $${totalAmount.toFixed(2)}`);
            console.log(`   Items: ${cartItems.length}`);
            
            return {
                success: true,
                receiptId: receiptId,
                receiptNumber: receiptId.split('_')[1],
                totalAmount: totalAmount,
                itemsProcessed: cartItems.length,
                seller: this.seller.name
            };
            
        } catch (error) {
            console.error('❌ Sale failed:', error);
            return {
                success: false,
                error: error.message,
                code: error.code
            };
        }
    }
}

// ====================================================
// MAIN EXPORT FUNCTION
// ====================================================
export async function completeSaleFrontend(cartItems, shopId, userId, sellerInfo, paymentDetails) {
    const processor = new SaleProcessor(shopId, userId, sellerInfo);
    return await processor.processSale(cartItems, paymentDetails);
}

// Quick version for testing
export async function quickSale(cartItems, shopId) {
    try {
        const batch = writeBatch(db);
        
        cartItems.forEach(item => {
            const itemRef = doc(db, 'Shops', shopId, 'items', item.item_id);
            batch.update(itemRef, {
                'stock': increment(-item.quantity),
                'lastStockUpdate': new Date().toISOString()
            });
        });
        
        await batch.commit();
        return { success: true, message: `Updated ${cartItems.length} items` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}
